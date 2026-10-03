import type { Env } from '../config/env.js';

/**
 * Demo data carries known passwords, so it may only ever reach a local or test database
 * (brief §35: no default credentials outside local seed data).
 */
export function assertSeedAllowed(env: Pick<Env, 'APP_ENV'>): void {
  if (env.APP_ENV !== 'local' && env.APP_ENV !== 'test') {
    throw new Error(
      `Refusing to seed: APP_ENV is "${env.APP_ENV}", seeding runs only in local or test`,
    );
  }
}

export interface InviteOptions {
  count: number;
  maxUses: number;
  expiresDays: number;
  note: string | null;
}

/** Parses `--count 5 --max-uses 1 --expires-days 30 --note "..."`. */
export function parseInviteArgs(argv: readonly string[]): InviteOptions {
  const options: InviteOptions = { count: 1, maxUses: 1, expiresDays: 30, note: null };
  const integer = (flag: string, value: string | undefined, min: number, max: number) => {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
      throw new Error(`${flag} must be an integer from ${min} to ${max}`);
    }
    return parsed;
  };
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === '--count') options.count = integer(flag, value, 1, 100);
    else if (flag === '--max-uses') options.maxUses = integer(flag, value, 1, 1000);
    else if (flag === '--expires-days') options.expiresDays = integer(flag, value, 0, 365);
    else if (flag === '--note' && value) options.note = value.slice(0, 200);
    else throw new Error(`Unknown option ${flag ?? ''}`);
  }
  return options;
}
