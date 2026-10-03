import { eq } from 'drizzle-orm';
import { featureFlags } from '../db/schema.js';
import type { Db } from '../platform/database.js';
import {
  FLAG_KEYS,
  type FlagKey,
  FULL_ROLLOUT_PERCENT,
  isFlagKey,
} from '../platform/feature-flags.js';
import { audit } from '../platform/outbox.js';

export const FLAGS_USAGE = `Usage: flags set <key> on|off
Keys: ${FLAG_KEYS.join(', ')}`;

export interface FlagCommand {
  key: FlagKey;
  enabled: boolean;
}

/** Parses `set <key> on|off`; only known flag keys are accepted, so a typo cannot create a row. */
export function parseFlagArgs(argv: readonly string[]): FlagCommand {
  const [command, key, value, ...rest] = argv;
  if (command !== 'set' || key === undefined || value === undefined || rest.length > 0) {
    throw new Error(FLAGS_USAGE);
  }
  if (!isFlagKey(key)) throw new Error(`Unknown flag "${key}". ${FLAGS_USAGE}`);
  if (value !== 'on' && value !== 'off') throw new Error(`Expected on or off. ${FLAGS_USAGE}`);
  return { key, enabled: value === 'on' };
}

export interface FlagChange {
  key: FlagKey;
  /** Whether the flag was effectively on before (a missing row reads as off). */
  wasEnabled: boolean;
  enabled: boolean;
}

/**
 * Turns a flag on (enabled, full rollout) or off and writes the audit entry in the same
 * transaction (no actor: it is an ops tool). API processes see it within their flag cache time.
 */
export async function setFlag(db: Db, { key, enabled }: FlagCommand): Promise<FlagChange> {
  return db.transaction(async (tx) => {
    const [before] = await tx
      .select({ enabled: featureFlags.enabled, rolloutPercent: featureFlags.rolloutPercent })
      .from(featureFlags)
      .where(eq(featureFlags.key, key))
      .for('update');
    const change = enabled
      ? { enabled: true, rolloutPercent: FULL_ROLLOUT_PERCENT }
      : { enabled: false };
    await tx
      .insert(featureFlags)
      .values({ key, ...change })
      .onConflictDoUpdate({ target: featureFlags.key, set: change });
    await audit(tx, {
      actorId: null,
      action: 'feature_flag.set',
      entityType: 'feature_flag',
      entityId: null,
      before: before ? { key, ...before } : { key, missing: true },
      after: { key, ...change, via: 'cli' },
    });
    const wasEnabled = Boolean(before?.enabled && before.rolloutPercent >= FULL_ROLLOUT_PERCENT);
    return { key, wasEnabled, enabled };
  });
}
