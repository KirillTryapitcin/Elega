/**
 * Account rules without zod, so client components can import `@elega/shared/account-rules`
 * without pulling the schema library into the bundle. `accounts.ts` re-exports all of it.
 */
/** Minimum age to register (brief §8.1, decided 2026-10-02). Under 14 is blocked outright. */
export const MIN_SIGNUP_AGE = 14;
/** Users under this age are minors and get stricter defaults (brief §21.3). */
export const ADULT_AGE = 18;
/** Oldest birthdate we accept, to catch typos such as 1086 instead of 1986. */
export const MAX_AGE = 120;

/** Display names: 1–64 characters after trimming (users.display_name CHECK). */
export const DISPLAY_NAME_MAX_LENGTH = 64;

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 256;

/** Lowercase letters, digits, dots and underscores; no consecutive dots (brief §9.5). */
export const USERNAME_PATTERN = /^[a-z0-9._]{3,30}$/;

/**
 * Names that could impersonate the platform or collide with routes. Compared after removing
 * dots and underscores, so `ad.min` and `support_` are reserved too.
 */
export const RESERVED_USERNAMES: ReadonlySet<string> = new Set([
  'admin',
  'administrator',
  'api',
  'app',
  'auth',
  'elega',
  'elegaru',
  'help',
  'login',
  'logout',
  'me',
  'moderator',
  'mod',
  'root',
  'security',
  'settings',
  'signup',
  'staff',
  'support',
  'system',
  'official',
  'feed',
  'search',
  'notifications',
  'messages',
  'groups',
  'pages',
  'events',
  'stories',
  'about',
  'legal',
  'privacy',
  'terms',
  'null',
  'undefined',
]);

export type UsernameProblem = 'format' | 'consecutive_dots' | 'reserved';

/** Returns why a username is not allowed, or null when it is fine. */
export function usernameProblem(username: string): UsernameProblem | null {
  if (!USERNAME_PATTERN.test(username)) return 'format';
  if (username.includes('..')) return 'consecutive_dots';
  if (RESERVED_USERNAMES.has(username.replace(/[._]/g, ''))) return 'reserved';
  return null;
}

/** Parses an ISO date (YYYY-MM-DD) as a calendar date, independent of the server time zone. */
function parseIsoDate(value: string): { y: number; m: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) {
    return null;
  }
  return { y, m, d };
}

/** Full years between a birthdate and `today` (both calendar dates in UTC). */
export function ageOn(birthdate: string, today: Date = new Date()): number | null {
  const born = parseIsoDate(birthdate);
  if (!born) return null;
  const ty = today.getUTCFullYear();
  const tm = today.getUTCMonth() + 1;
  const td = today.getUTCDate();
  let age = ty - born.y;
  if (tm < born.m || (tm === born.m && td < born.d)) age -= 1;
  return age;
}

export function isMinor(birthdate: string, today: Date = new Date()): boolean {
  const age = ageOn(birthdate, today);
  return age === null || age < ADULT_AGE;
}

/** Documents with a version the user accepts; `pd_dissemination` is the Art. 10.1 consent text. */
export const LEGAL_DOCUMENTS = ['terms', 'privacy', 'pd_processing', 'pd_dissemination'] as const;
export type LegalDocument = (typeof LEGAL_DOCUMENTS)[number];

/**
 * Settings a minor may not loosen (brief §21.3: no messages from strangers, restricted
 * discoverability). Values are the strictest-allowed choices; anything else is rejected.
 */
export const MINOR_SETTING_LIMITS = {
  whoCanMessage: ['friends', 'nobody'],
  whoCanSendFriendRequests: ['friends_of_friends', 'nobody'],
  whoCanSeeOnlineStatus: ['friends', 'nobody'],
  whoCanMention: ['friends', 'nobody'],
  defaultPostAudience: ['friends', 'close_friends', 'only_me'],
  searchEngineIndexing: [false],
  discoverableByEmail: [false],
  allowFollowers: [false],
} as const satisfies Record<string, readonly (string | boolean)[]>;

/** Defaults written for a new minor account; adults get the database defaults. */
export const MINOR_DEFAULT_SETTINGS = {
  whoCanMessage: 'friends',
  whoCanSendFriendRequests: 'friends_of_friends',
  whoCanSeeOnlineStatus: 'friends',
  whoCanMention: 'friends',
  defaultPostAudience: 'friends',
  searchEngineIndexing: false,
  discoverableByEmail: false,
  allowFollowers: false,
} as const;

/** Returns the setting keys a minor is trying to loosen beyond the limits. */
export function minorSettingViolations(patch: Record<string, unknown>): string[] {
  return Object.entries(MINOR_SETTING_LIMITS)
    .filter(
      ([key, allowed]) => key in patch && !(allowed as readonly unknown[]).includes(patch[key]),
    )
    .map(([key]) => key);
}
