import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import type { Env } from '../config/env.js';

export const PG_POOL = Symbol('PG_POOL');
export const DB = Symbol('DB');
export type Db = NodePgDatabase;
/** A transaction handle, as passed to `db.transaction(async (tx) => ...)`. */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
/** Anything that can run queries: the pool-backed client or an open transaction. */
export type Executor = Db | Tx;

export function createPool(env: Pick<Env, 'DATABASE_URL' | 'DATABASE_POOL_MAX'>): pg.Pool {
  return new pg.Pool({
    connectionString: env.DATABASE_URL,
    max: env.DATABASE_POOL_MAX,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    application_name: 'elega-api',
  });
}

export function createDb(pool: pg.Pool): Db {
  return drizzle({ client: pool });
}
