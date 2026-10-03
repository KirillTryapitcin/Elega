import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { featureFlags } from '../db/schema.js';
import { DB, type Db } from './database.js';

const CACHE_MS = 30_000;
/** A flag is on only when enabled for everyone; percentage rollouts arrive with the admin panel. */
export const FULL_ROLLOUT_PERCENT = 100;

/**
 * Known flags. Unknown or missing rows read as off, so a flag that gates exposure is closed
 * until someone turns it on (`pnpm --filter @elega/api flags set <key> on`).
 * - `auth.google`: Google sign-in.
 * - `media.uploads_paused`: kill switch; new upload slots and completions get 403
 *   `media_uploads_paused`, and the media worker pauses.
 * - `profiles.public_access`: profiles may be opened to anonymous visitors and search engines.
 */
export const FLAG_KEYS = ['auth.google', 'media.uploads_paused', 'profiles.public_access'] as const;
export type FlagKey = (typeof FLAG_KEYS)[number];

export function isFlagKey(value: string): value is FlagKey {
  return (FLAG_KEYS as readonly string[]).includes(value);
}

/**
 * Reads `feature_flags` with a short in-process cache, so a change made by the CLI reaches
 * every API process within `CACHE_MS`.
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
    const value = Boolean(row?.enabled && row.rollout >= FULL_ROLLOUT_PERCENT);
    this.cache.set(key, { value, until: Date.now() + CACHE_MS });
    return value;
  }

  /** Drops cached values (tests flip flags in the database and need the change at once). */
  invalidate(key?: FlagKey): void {
    if (key) this.cache.delete(key);
    else this.cache.clear();
  }
}
