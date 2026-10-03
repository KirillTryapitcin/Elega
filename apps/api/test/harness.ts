import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { Test } from '@nestjs/testing';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import pg from 'pg';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';
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
const S3_CONFIG_URL = new URL('../../../infra/seaweedfs/s3.json', import.meta.url);

/** Same pins as docker-compose.yml and CI (which overrides them through TEST_*). */
export const TEST_IMAGES = {
  postgres: process.env.TEST_POSTGRES_IMAGE ?? 'postgres:16.15-alpine',
  redis: process.env.TEST_REDIS_IMAGE ?? 'redis:7.4.11-alpine',
  s3: process.env.TEST_S3_IMAGE ?? 'chrislusf/seaweedfs:4.48',
};

export const S3_BUCKETS = { private: 'elega-private', public: 'elega-public' } as const;
/** The only origin SeaweedFS answers CORS preflights for (the compose web origin). */
export const S3_CORS_ORIGIN = 'http://localhost:8080';
const S3_PORT = 8333;

interface S3Identity {
  accessKey: string;
  secretKey: string;
}

/** Credentials of the identities in infra/seaweedfs/s3.json, read from the file itself. */
export const S3_IDENTITIES: { api: S3Identity; worker: S3Identity } = (() => {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed path in the repo
  const config = JSON.parse(readFileSync(S3_CONFIG_URL, 'utf8')) as {
    identities: Array<{ name: string; credentials?: S3Identity[] }>;
  };
  const credentials = (name: string): S3Identity => {
    const found = config.identities.find((identity) => identity.name === name)?.credentials?.[0];
    if (!found) throw new Error(`infra/seaweedfs/s3.json has no identity ${name}`);
    return found;
  };
  return { api: credentials('elega-api'), worker: credentials('elega-worker') };
})();

/**
 * Storage settings for tests that never reach S3: the client is built without a network call,
 * presigning works offline, and readyz reports storage as failed (degraded).
 */
export const PLACEHOLDER_S3_ENV: Record<string, string> = {
  S3_ENDPOINT: 'http://127.0.0.1:1',
  S3_PUBLIC_ENDPOINT: 'http://media.elega.test',
  S3_ACCESS_KEY: 'test_local_only_placeholder',
  S3_SECRET_KEY: 'test_local_only_placeholder_secret',
  S3_BUCKET_PRIVATE: S3_BUCKETS.private,
  S3_BUCKET_PUBLIC: S3_BUCKETS.public,
};

export interface StartedStorage {
  container: StartedTestContainer;
  /** Origin of the S3 API as seen from the tests (also what presigned URLs are signed for). */
  endpoint: string;
  /** S3_* variables for the API's own identity. */
  env: Record<string, string>;
  stop(): Promise<void>;
}

/**
 * SeaweedFS with the compose command and infra/seaweedfs/s3.json: both buckets created at
 * start, the API and worker identities, no admin and no anonymous identity.
 */
export async function startStorage(): Promise<StartedStorage> {
  const container = await new GenericContainer(TEST_IMAGES.s3)
    .withCommand([
      'mini',
      '-dir=/data',
      '-s3.config=/etc/seaweedfs/s3.json',
      `-bucket=${S3_BUCKETS.private},${S3_BUCKETS.public}`,
      '-webdav=false',
      '-admin.ui=false',
      '-s3.port.iceberg=0',
      '-s3.port.lance=0',
      `-s3.allowedOrigins=${S3_CORS_ORIGIN}`,
      '-master.telemetry=false',
    ])
    .withCopyFilesToContainer([
      { source: fileURLToPath(S3_CONFIG_URL), target: '/etc/seaweedfs/s3.json' },
    ])
    .withExposedPorts(S3_PORT)
    .withWaitStrategy(
      Wait.forAll([
        Wait.forLogMessage(`created bucket ${S3_BUCKETS.private}`),
        Wait.forLogMessage(`created bucket ${S3_BUCKETS.public}`),
        Wait.forHttp('/healthz', S3_PORT),
      ]),
    )
    .start();
  const endpoint = `http://${container.getHost()}:${container.getMappedPort(S3_PORT)}`;
  return {
    container,
    endpoint,
    env: {
      S3_ENDPOINT: endpoint,
      S3_PUBLIC_ENDPOINT: endpoint,
      S3_ACCESS_KEY: S3_IDENTITIES.api.accessKey,
      S3_SECRET_KEY: S3_IDENTITIES.api.secretKey,
      S3_BUCKET_PRIVATE: S3_BUCKETS.private,
      S3_BUCKET_PUBLIC: S3_BUCKETS.public,
    },
    stop: async () => {
      await container.stop();
    },
  };
}

export interface Infra {
  postgres: StartedPostgreSqlContainer;
  redis: StartedRedisContainer;
  /** Present only with `startInfra({ storage: true })`. */
  storage?: StartedStorage;
  pool: pg.Pool;
  stop(): Promise<void>;
}

export interface InfraOptions {
  /** Start SeaweedFS too (media tests); everything else runs with placeholder S3 settings. */
  storage?: boolean;
  /** Extra environment for the app, applied last. */
  env?: Record<string, string>;
}

/** Postgres and Redis (and optionally S3) in containers, schema migrated, environment set. */
export async function startInfra(options: InfraOptions = {}): Promise<Infra> {
  const [postgres, redis, storage] = await Promise.all([
    new PostgreSqlContainer(TEST_IMAGES.postgres).start(),
    new RedisContainer(TEST_IMAGES.redis).start(),
    options.storage ? startStorage() : Promise.resolve(undefined),
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
    ...(storage ? storage.env : PLACEHOLDER_S3_ENV),
    ...options.env,
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
    ...(storage ? { storage } : {}),
    pool,
    stop: async () => {
      await pool.end();
      await Promise.all([postgres.stop(), redis.stop(), storage?.stop()]);
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
