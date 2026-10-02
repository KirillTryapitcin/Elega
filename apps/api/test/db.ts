import { drizzle } from 'drizzle-orm/node-postgres';
import type { Infra } from './harness.js';

/** A Drizzle client on the test pool, for seeding through the app's own services. */
export function getDb(infra: Infra) {
  return drizzle({ client: infra.pool });
}
