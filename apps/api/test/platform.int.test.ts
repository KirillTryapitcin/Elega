import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { createApp } from '../src/app.js';
import { migrate, readMigrations } from '../src/db/migrate.js';
import * as schema from '../src/db/schema.js';
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';
import { isBlockedDomain } from '../src/platform/link-policy.js';
import { type StartedStorage, startStorage, TEST_IMAGES } from './harness.js';
import { drizzle } from 'drizzle-orm/node-postgres';

const MIGRATIONS = fileURLToPath(new URL('../migrations', import.meta.url));
const SPEC = parse(
  readFileSync(fileURLToPath(new URL('../../../docs/api/openapi.yaml', import.meta.url)), 'utf8'),
) as { paths: Record<string, Record<string, unknown>> };
const registered: Array<{ method: string; url: string }> = [];

let postgres: StartedPostgreSqlContainer;
let redis: StartedRedisContainer;
let storage: StartedStorage;
let app: NestFastifyApplication;

beforeAll(async () => {
  [postgres, redis, storage] = await Promise.all([
    new PostgreSqlContainer(TEST_IMAGES.postgres).start(),
    new RedisContainer(TEST_IMAGES.redis).start(),
    startStorage(),
  ]);
  process.env.DATABASE_URL = postgres.getConnectionUri();
  process.env.REDIS_URL = redis.getConnectionUrl();
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'warn';
  process.env.APP_BASE_URL = 'http://elega.test';
  process.env.APP_SECRET = 'integration-test-secret-0123456789abcdef';
  Object.assign(process.env, storage.env);
  app = await createApp();
  // Routes are registered during init(), so this hook sees every one of them.
  app
    .getHttpAdapter()
    .getInstance()
    .addHook('onRoute', (route) => {
      for (const method of [route.method].flat()) registered.push({ method, url: route.url });
    });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});

afterAll(async () => {
  await app?.close();
  await Promise.all([postgres?.stop(), redis?.stop(), storage?.stop()]);
});

describe('migrations', () => {
  it('apply to an empty database and are idempotent', async () => {
    const client = new pg.Client({ connectionString: postgres.getConnectionUri() });
    await client.connect();
    try {
      const migrations = await readMigrations(MIGRATIONS);
      const first = await migrate(client, migrations);
      expect(first.applied).toEqual(migrations.map((m) => m.name));
      const second = await migrate(client, migrations);
      expect(second.applied).toEqual([]);

      const { rows } = await client.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public'",
      );
      expect(rows[0]?.n).toBeGreaterThan(40);

      // Drizzle definitions must match the migrated schema, column by column.
      for (const table of Object.values(schema).filter((value) => value instanceof PgTable)) {
        const config = getTableConfig(table);
        const { rows: columns } = await client.query<{ column_name: string; is_nullable: string }>(
          'SELECT column_name, is_nullable FROM information_schema.columns WHERE table_name = $1',
          [config.name],
        );
        const actual = new Map(columns.map((c) => [c.column_name, c.is_nullable === 'NO']));
        for (const column of config.columns) {
          expect(actual.has(column.name), `${config.name}.${column.name} exists`).toBe(true);
          expect(actual.get(column.name), `${config.name}.${column.name} nullability`).toBe(
            column.notNull || column.primary,
          );
        }
      }

      const tampered = migrations.map((m, i) => (i === 0 ? { ...m, checksum: 'x' } : m));
      await expect(migrate(client, tampered)).rejects.toThrow(/checksum mismatch/);
    } finally {
      await client.end();
    }
  });
});

describe('link policy', () => {
  it('blocks a domain, its subdomains and either spelling of an IDN', async () => {
    const pool = new pg.Pool({ connectionString: postgres.getConnectionUri(), max: 1 });
    try {
      await pool.query(
        "INSERT INTO blocked_domains (domain, reason) VALUES ('Spam.Example', 'test'), ('пример.рф', 'test')",
      );
      const db = drizzle({ client: pool });
      for (const host of ['spam.example', 'cdn.SPAM.example.', 'xn--e1afmkfd.xn--p1ai']) {
        expect(await isBlockedDomain(db, host), host).toBe(true);
      }
      for (const host of ['example', 'notspam.example', 'spam.example.org', '']) {
        expect(await isBlockedDomain(db, host), host).toBe(false);
      }
    } finally {
      await pool.end();
    }
  });
});

describe('API contract', () => {
  it('every route the API serves is documented in docs/api/openapi.yaml', () => {
    const served = registered
      .filter((r) => r.method !== 'HEAD' && r.url.startsWith('/api/v1/'))
      .map((r) => `${r.method} ${r.url.slice('/api/v1'.length).replace(/:(\w+)/g, '{$1}')}`);
    expect(served.length).toBeGreaterThan(0);
    const documented = new Set(
      Object.entries(SPEC.paths).flatMap(([path, ops]) =>
        Object.keys(ops).map((m) => `${m.toUpperCase()} ${path}`),
      ),
    );
    expect(served.filter((route) => !documented.has(route))).toEqual([]);
  });
});

describe('platform endpoints', () => {
  it('GET /api/v1/healthz is ok and echoes a request id', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/healthz' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('GET /api/v1/readyz checks Postgres, Redis and object storage', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/readyz' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      status: 'ok',
      checks: { database: 'ok', redis: 'ok', storage: 'ok' },
    });
  });

  it('unknown routes return the unified error body with the caller request id', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/nope',
      headers: { 'x-request-id': 'caddy-req-12345678' },
    });
    expect(res.statusCode).toBe(404);
    expect(res.headers['x-request-id']).toBe('caddy-req-12345678');
    expect(res.json()).toEqual({
      error: { code: 'not_found', message: 'Not found', requestId: 'caddy-req-12345678' },
    });
  });

  it('malformed JSON is a validation error, not a 500', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/healthz',
      headers: { 'content-type': 'application/json' },
      payload: '{"broken":',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('validation_failed');
  });

  it('sets security headers', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/healthz' });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
  });

  // The two tests below stop containers, so they run last and in this order.
  it('readyz stays in rotation, degraded, when only object storage is gone', async () => {
    await storage.stop();
    const res = await app.inject({ method: 'GET', url: '/api/v1/readyz' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      status: 'degraded',
      checks: { database: 'ok', redis: 'ok', storage: 'fail' },
    });
  });

  it('readyz reports down when Redis is gone', async () => {
    await redis.stop();
    const res = await app.inject({ method: 'GET', url: '/api/v1/readyz' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({
      status: 'down',
      checks: { database: 'ok', redis: 'fail', storage: 'fail' },
    });
  });
});
