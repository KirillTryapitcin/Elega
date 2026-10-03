import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { POLICY_MATRIX } from '@elega/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { API_PREFIX, createApp } from '../src/app.js';
import { ROUTE_POLICIES } from '../src/platform/route-policies.js';
import { APP_BASE_URL, PLACEHOLDER_S3_ENV } from './harness.js';

/**
 * ADR-013: every route the API serves names the authorization policy that governs it. Building
 * the app connects to nothing (pools and Redis connect lazily), so no containers are needed.
 */
const SPEC = parse(
  readFileSync(fileURLToPath(new URL('../../../docs/api/openapi.yaml', import.meta.url)), 'utf8'),
) as { paths: Record<string, Record<string, unknown>> };
const PREFIX = `/${API_PREFIX}`;
const HTTP_METHODS = new Set(['get', 'put', 'post', 'patch', 'delete']);

const registered: string[] = [];
let app: NestFastifyApplication;

beforeAll(async () => {
  Object.assign(process.env, {
    NODE_ENV: 'test',
    APP_ENV: 'test',
    LOG_LEVEL: 'warn',
    // Nothing listens on port 1: a query would fail loudly instead of passing by accident.
    DATABASE_URL: 'postgres://elega:unused@127.0.0.1:1/elega',
    REDIS_URL: 'redis://127.0.0.1:1',
    APP_BASE_URL,
    APP_SECRET: 'route-policy-test-secret-0123456789abcdef',
    ...PLACEHOLDER_S3_ENV,
  });
  app = await createApp();
  app
    .getHttpAdapter()
    .getInstance()
    .addHook('onRoute', (route) => {
      for (const method of [route.method].flat()) {
        if (method !== 'HEAD' && route.url.startsWith(`${PREFIX}/`)) {
          registered.push(`${method} ${route.url.slice(PREFIX.length)}`);
        }
      }
    });
  await app.init();
});

afterAll(async () => {
  await app?.close();
});

describe('route policies', () => {
  it('cover every registered route', () => {
    expect(registered.length).toBeGreaterThan(0);
    expect(registered.filter((route) => !(route in ROUTE_POLICIES))).toEqual([]);
  });

  it('name only rows that exist in the policy matrix', () => {
    const rows = new Set(POLICY_MATRIX.flatMap((table) => table.rows.map((row) => row.action)));
    const unknown = Object.entries(ROUTE_POLICIES).flatMap(([route, policy]) =>
      'rows' in policy
        ? policy.rows.filter((row) => !rows.has(row)).map((row) => `${route}: ${row}`)
        : [],
    );
    expect(unknown).toEqual([]);
  });

  it('list only routes the API contract documents', () => {
    const documented = new Set(
      Object.entries(SPEC.paths).flatMap(([path, operations]) =>
        Object.keys(operations)
          .filter((method) => HTTP_METHODS.has(method))
          .map((method) => `${method.toUpperCase()} ${path.replace(/\{(\w+)\}/g, ':$1')}`),
      ),
    );
    expect(Object.keys(ROUTE_POLICIES).filter((route) => !documented.has(route))).toEqual([]);
  });
});
