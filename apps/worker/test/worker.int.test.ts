import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import { pino } from 'pino';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { loadEnv } from '../src/env.js';
import { startWorker, type RunningWorker } from '../src/worker.js';

let redis: StartedRedisContainer;
let worker: RunningWorker;
const PORT = 39_402;

beforeAll(async () => {
  redis = await new RedisContainer(process.env.TEST_REDIS_IMAGE ?? 'redis:7-alpine').start();
  const env = loadEnv({
    REDIS_URL: redis.getConnectionUrl(),
    HEALTH_PORT: String(PORT),
    HEARTBEAT_EVERY_MS: '1000',
  });
  worker = await startWorker(env, pino({ level: 'silent' }));
});

afterAll(async () => {
  await worker?.close();
  await redis?.stop();
});

it('processes its heartbeat job and reports healthy', async () => {
  await expect
    .poll(async () => (await fetch(`http://127.0.0.1:${PORT}/healthz`)).status, {
      timeout: 15_000,
      interval: 250,
    })
    .toBe(200);
  const body = await (await fetch(`http://127.0.0.1:${PORT}/healthz`)).json();
  expect(body).toEqual({ status: 'ok', checks: { heartbeat: 'ok' } });
});
