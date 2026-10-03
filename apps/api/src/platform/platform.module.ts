import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import type { Redis } from 'ioredis';
import type pg from 'pg';
import { ENV, type Env, loadEnv } from '../config/env.js';
import { createKeyring, KEYRING } from './crypto.js';
import { createDb, createPool, DB, PG_POOL } from './database.js';
import { FeatureFlags } from './feature-flags.js';
import { HealthController } from './health.controller.js';
import { RateLimiter } from './rate-limit.js';
import { createRedis, REDIS } from './redis.js';

@Global()
@Module({
  controllers: [HealthController],
  providers: [
    { provide: ENV, useFactory: () => loadEnv() },
    { provide: PG_POOL, inject: [ENV], useFactory: (env: Env) => createPool(env) },
    { provide: DB, inject: [PG_POOL], useFactory: (pool: pg.Pool) => createDb(pool) },
    { provide: REDIS, inject: [ENV], useFactory: (env: Env) => createRedis(env) },
    { provide: KEYRING, inject: [ENV], useFactory: (env: Env) => createKeyring(env) },
    RateLimiter,
    FeatureFlags,
  ],
  exports: [ENV, PG_POOL, DB, REDIS, KEYRING, RateLimiter, FeatureFlags],
})
export class PlatformModule implements OnApplicationShutdown {
  constructor(
    @Inject(PG_POOL) private readonly pool: pg.Pool,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async onApplicationShutdown(): Promise<void> {
    this.redis.disconnect();
    await this.pool.end();
  }
}
