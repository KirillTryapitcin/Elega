import { Controller, Get, HttpCode, Inject, Res } from '@nestjs/common';
import type { Health } from '@elega/shared';
import type { FastifyReply } from 'fastify';
import type { Redis } from 'ioredis';
import type pg from 'pg';
import { PG_POOL } from './database.js';
import { REDIS } from './redis.js';
import { NoRateLimit } from './rate-limit.js';
import { Public } from './request-context.js';

const CHECK_TIMEOUT_MS = 1_000;

function withTimeout<T>(promise: Promise<T>): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('timeout')), CHECK_TIMEOUT_MS).unref();
    }),
  ]);
}

async function check(run: () => Promise<unknown>): Promise<'ok' | 'error'> {
  try {
    await withTimeout(run());
    return 'ok';
  } catch {
    return 'error';
  }
}

@Public()
@NoRateLimit()
@Controller()
export class HealthController {
  constructor(
    @Inject(PG_POOL) private readonly pool: pg.Pool,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  /** Liveness: the process is up and serving. No dependencies are checked. */
  @Get('healthz')
  @HttpCode(200)
  healthz(): Health {
    return { status: 'ok' };
  }

  /** Readiness: Postgres and Redis answer within a second. */
  @Get('readyz')
  async readyz(@Res({ passthrough: true }) reply: FastifyReply): Promise<Health> {
    const [database, redis] = await Promise.all([
      check(() => this.pool.query('SELECT 1')),
      check(() => this.redis.ping()),
    ]);
    const ok = database === 'ok' && redis === 'ok';
    void reply.status(ok ? 200 : 503);
    return { status: ok ? 'ok' : 'down', checks: { database, redis } };
  }
}
