import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { Test } from '@nestjs/testing';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import pg from 'pg';
import { AppModule } from '../src/app.module.js';
import { configureApp, createAdapter } from '../src/app.js';
import { migrate, readMigrations } from '../src/db/migrate.js';
import {
  DEFAULT_OAUTH_ENDPOINTS,
  OAUTH_ENDPOINTS,
  type OAuthEndpoints,
} from '../src/modules/auth/oauth/providers.js';

export const APP_BASE_URL = 'http://elega.test';
const MIGRATIONS = fileURLToPath(new URL('../migrations', import.meta.url));

export interface Infra {
  postgres: StartedPostgreSqlContainer;
  redis: StartedRedisContainer;
  pool: pg.Pool;
  stop(): Promise<void>;
}

/** Postgres and Redis in containers, schema migrated, environment set for the app. */
export async function startInfra(env: Record<string, string> = {}): Promise<Infra> {
  const [postgres, redis] = await Promise.all([
    new PostgreSqlContainer(process.env.TEST_POSTGRES_IMAGE ?? 'postgres:16-alpine').start(),
    new RedisContainer(process.env.TEST_REDIS_IMAGE ?? 'redis:7-alpine').start(),
  ]);
  Object.assign(process.env, {
    DATABASE_URL: postgres.getConnectionUri(),
    REDIS_URL: redis.getConnectionUrl(),
    NODE_ENV: 'test',
    APP_ENV: 'test',
    LOG_LEVEL: 'warn',
    APP_BASE_URL,
    APP_SECRET: 'integration-test-secret-0123456789abcdef',
    REGISTRATION_MODE: 'invite_only',
    ...env,
  });
  const pool = new pg.Pool({ connectionString: postgres.getConnectionUri(), max: 2 });
  const client = await pool.connect();
  try {
    await migrate(client, await readMigrations(MIGRATIONS));
  } finally {
    client.release();
  }
  return {
    postgres,
    redis,
    pool,
    stop: async () => {
      await pool.end();
      await Promise.all([postgres.stop(), redis.stop()]);
    },
  };
}

export async function buildApp(oauthEndpoints: OAuthEndpoints = DEFAULT_OAUTH_ENDPOINTS) {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(OAUTH_ENDPOINTS)
    .useValue(oauthEndpoints)
    .compile();
  const app = moduleRef.createNestApplication<NestFastifyApplication>(createAdapter(), {
    bufferLogs: true,
  });
  await configureApp(app);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}

/** Reads the `name=value` pair of a Set-Cookie header. */
export function cookieValue(
  setCookie: string | string[] | undefined,
  name: string,
): string | undefined {
  const all = [setCookie ?? []].flat();
  for (const header of all) {
    const [pair] = header.split(';');
    const [key, ...rest] = (pair ?? '').split('=');
    if (key === name) return rest.join('=');
  }
  return undefined;
}

/** A fake OAuth provider over HTTP, so the real provider client code runs in tests. */
export async function startFakeProvider(profile: () => Record<string, unknown>): Promise<{
  endpoints: OAuthEndpoints;
  requests: Array<{ path: string; body: string }>;
  close(): Promise<void>;
}> {
  const requests: Array<{ path: string; body: string }> = [];
  const server: Server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk: Buffer) => (body += chunk.toString()));
    req.on('end', () => {
      requests.push({ path: req.url ?? '', body });
      res.setHeader('content-type', 'application/json');
      if (req.url?.startsWith('/vk/token')) {
        const form = new URLSearchParams(body);
        if (!form.get('code_verifier') || !form.get('device_id')) {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: 'invalid_request' }));
          return;
        }
        res.end(JSON.stringify({ access_token: 'vk-access', user_id: 1, token_type: 'Bearer' }));
        return;
      }
      if (req.url?.startsWith('/vk/userinfo')) {
        res.end(JSON.stringify({ user: profile() }));
        return;
      }
      res.statusCode = 404;
      res.end('{}');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    endpoints: {
      ...DEFAULT_OAUTH_ENDPOINTS,
      vk: {
        authorize: `${base}/vk/authorize`,
        token: `${base}/vk/token`,
        userInfo: `${base}/vk/userinfo`,
      },
    },
    requests,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
