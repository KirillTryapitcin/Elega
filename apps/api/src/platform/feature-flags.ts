import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { featureFlags } from '../db/schema.js';
import { DB, type Db } from './database.js';

const CACHE_MS = 30_000;

/** Known flags. Unknown or missing rows read as off. */
export type FlagKey = 'auth.google';

/**
 * Reads `feature_flags` with a short in-process cache. Percentage rollouts and rules arrive
 * with the admin panel; for now a flag is on only when `enabled` and rollout is 100%.
 */
@Injectable()
export class FeatureFlags {
  private readonly cache = new Map<string, { value: boolean; until: number }>();

  constructor(@Inject(DB) private readonly db: Db) {}

  async isEnabled(key: FlagKey): Promise<boolean> {
    const cached = this.cache.get(key);
    if (cached && cached.until > Date.now()) return cached.value;
    const [row] = await this.db
      .select({ enabled: featureFlags.enabled, rollout: featureFlags.rolloutPercent })
      .from(featureFlags)
      .where(eq(featureFlags.key, key));
    const value = Boolean(row?.enabled && row.rollout >= 100);
    this.cache.set(key, { value, until: Date.now() + CACHE_MS });
    return value;
  }
}
