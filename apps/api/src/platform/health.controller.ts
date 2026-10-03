import { Controller, Get, HttpCode, Inject, Res } from '@nestjs/common';
import type { Health } from '@elega/shared';
import type { FastifyReply } from 'fastify';
import type { Redis } from 'ioredis';
import type pg from 'pg';
import { PG_POOL } from './database.js';
import { REDIS } from './redis.js';
import { NoRateLimit } from './rate-limit.js';
import { Public } from './request-context.js';
import { STORAGE, STORAGE_PING_TIMEOUT_MS, type Storage } from './storage.js';

const CHECK_TIMEOUT_MS = 1_000;

type CheckResult = 'ok' | 'fail';

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('timeout')), timeoutMs).unref();
    }),
  ]);
}

async function check(
  run: () => Promise<unknown>,
  timeoutMs = CHECK_TIMEOUT_MS,
): Promise<CheckResult> {
  try {
    await withTimeout(run(), timeoutMs);
    return 'ok';
  } catch {
    return 'fail';
  }
}

@Public()
@NoRateLimit()
@Controller()
export class HealthController {
  constructor(
    @Inject(PG_POOL) private readonly pool: pg.Pool,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(STORAGE) private readonly storage: Storage,
  ) {}

  /** Liveness: the process is up and serving. No dependencies are checked. */
  @Get('healthz')
  @HttpCode(200)
  healthz(): Health {
    return { status: 'ok' };
  }

  /**
   * Readiness: Postgres and Redis answer within a second (else 503 `down`, the instance leaves
   * rotation). Object storage is checked too, but only media depends on it, so a failure is
   * 200 `degraded`: sign-in, profiles and settings keep working.
   */
  @Get('readyz')
  async readyz(@Res({ passthrough: true }) reply: FastifyReply): Promise<Health> {
    const [database, redis, storage] = await Promise.all([
      check(() => this.pool.query('SELECT 1')),
      check(() => this.redis.ping()),
      check(() => this.storage.ping(), STORAGE_PING_TIMEOUT_MS),
    ]);
    const down = database !== 'ok' || redis !== 'ok';
    void reply.status(down ? 503 : 200);
    const status = down ? 'down' : storage === 'ok' ? 'ok' : 'degraded';
    return { status, checks: { database, redis, storage } };
  }
}
