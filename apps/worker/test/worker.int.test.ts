import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import pg from 'pg';
import { pino } from 'pino';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { loadEnv } from '../src/env.js';
import { type RunningWorker, startWorker } from '../src/worker.js';

const MIGRATIONS = fileURLToPath(new URL('../../api/migrations', import.meta.url));

let postgres: StartedPostgreSqlContainer;
let redis: StartedRedisContainer;
let mailpit: StartedTestContainer;
let pool: pg.Pool;
let worker: RunningWorker;

beforeAll(async () => {
  [postgres, redis, mailpit] = await Promise.all([
    new PostgreSqlContainer(process.env.TEST_POSTGRES_IMAGE ?? 'postgres:16-alpine').start(),
    new RedisContainer(process.env.TEST_REDIS_IMAGE ?? 'redis:7-alpine').start(),
    new GenericContainer(process.env.TEST_MAILPIT_IMAGE ?? 'axllent/mailpit:v1.31.3')
      .withExposedPorts(1025, 8025)
      .withWaitStrategy(Wait.forListeningPorts())
      .start(),
  ]);
  pool = new pg.Pool({ connectionString: postgres.getConnectionUri() });
  for (const file of readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith('.sql'))
    .sort()) {
    await pool.query(readFileSync(`${MIGRATIONS}/${file}`, 'utf8'));
  }
  const env = loadEnv({
    REDIS_URL: redis.getConnectionUrl(),
    DATABASE_URL: postgres.getConnectionUri(),
    SMTP_URL: `smtp://${mailpit.getHost()}:${mailpit.getMappedPort(1025)}`,
    APP_BASE_URL: 'http://elega.test',
    HEALTH_PORT: '39403',
    HEARTBEAT_EVERY_MS: '1000',
    OUTBOX_POLL_MS: '200',
  });
  worker = await startWorker(env, pino({ level: 'silent' }));
});

afterAll(async () => {
  await worker?.close();
  await pool?.end();
  await Promise.all([postgres?.stop(), redis?.stop(), mailpit?.stop()]);
});

it('processes its heartbeat job and reports healthy', async () => {
  await expect
    .poll(async () => (await fetch('http://127.0.0.1:39403/healthz')).status, { timeout: 15_000 })
    .toBe(200);
  const body = await (await fetch('http://127.0.0.1:39403/healthz')).json();
  expect(body).toEqual({ status: 'ok', checks: { heartbeat: 'ok' } });
});

it('relays outbox emails to SMTP once and redacts the payload', async () => {
  const userId = '01900000-0000-7000-8000-000000000001';
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO outbox (aggregate_type, aggregate_id, event_type, payload_json)
     VALUES ('user', $1, 'email.requested', $2) RETURNING id`,
    [
      userId,
      {
        template: 'reset_password',
        to: 'anya@example.ru',
        locale: 'ru',
        linkPath: '/reset-password#token=secret-token',
        params: { name: 'Аня' },
      },
    ],
  );
  const api = `http://${mailpit.getHost()}:${mailpit.getMappedPort(8025)}/api/v1`;
  await expect
    .poll(
      async () => ((await (await fetch(`${api}/messages`)).json()) as { total: number }).total,
      {
        timeout: 15_000,
      },
    )
    .toBe(1);
  const list = (await (await fetch(`${api}/messages`)).json()) as {
    messages: Array<{ ID: string; Subject: string; To: Array<{ Address: string }> }>;
  };
  expect(list.messages[0]).toMatchObject({
    Subject: 'Сброс пароля',
    To: [{ Address: 'anya@example.ru' }],
  });
  const message = (await (await fetch(`${api}/message/${list.messages[0]!.ID}`)).json()) as {
    Text: string;
  };
  expect(message.Text).toContain('http://elega.test/reset-password#token=secret-token');

  const { rows: after } = await pool.query<{ published_at: Date | null; payload_json: unknown }>(
    'SELECT published_at, payload_json FROM outbox WHERE id = $1',
    [rows[0]!.id],
  );
  expect(after[0]?.published_at).not.toBeNull();
  expect(after[0]?.payload_json).toEqual({ redacted: true, template: 'reset_password' });
});
