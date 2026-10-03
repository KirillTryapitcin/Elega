/**
 * Profile privacy model (brief §9, authorization matrix rows "Profile: …"). The API decides with
 * these functions; the web uses the same ones for the owner's "view as" preview and for
 * validation on blur. Zod-free so client components can import `@elega/shared/profiles`.
 */
export { hasForbiddenChars, sanitizeProfileText, type TextRules } from './text.js';

/** Keys of `fieldAudience`: every profile part with its own audience. */
export const PROFILE_FIELDS = [
  'cover',
  'bio',
  'city',
  'country',
  'workplace',
  'education',
  'website',
  'links',
  'pronouns',
  'relationshipStatus',
  'birthday',
  'birthYear',
  'photos',
] as const;
export type ProfileField = (typeof PROFILE_FIELDS)[number];

/** The contract's audience set (brief §9.2). */
export const FIELD_AUDIENCES = [
  'public',
  'friends',
  'friends_of_friends',
  'only_me',
  'custom_list',
] as const;
export type FieldAudience = (typeof FIELD_AUDIENCES)[number];

/** Audiences M2 accepts; `custom_list` needs friend lists (M3). */
export const M2_FIELD_AUDIENCES = ['public', 'friends', 'friends_of_friends', 'only_me'] as const;
export type M2FieldAudience = (typeof M2_FIELD_AUDIENCES)[number];

/** Brief §9.2: everything except name, avatar and username defaults to friends. */
export const DEFAULT_FIELD_AUDIENCE = 'friends' satisfies M2FieldAudience;
/** Fields whose default is stricter than DEFAULT_FIELD_AUDIENCE. */
export const FIELD_DEFAULT_OVERRIDES = {
  birthYear: 'only_me',
} as const satisfies Partial<Record<ProfileField, M2FieldAudience>>;

/** Brief §9.2 and §21.3: a minor's fields are friends-only at most. */
export const MINOR_FIELD_AUDIENCES = ['friends', 'only_me'] as const;

/** Never shown to anonymous visitors whatever the audience (matrix row "Profile: photos"). */
export const ANON_EXCLUDED_FIELDS = ['photos'] as const satisfies readonly ProfileField[];

/** Header parts every member sees; a dissemination consent always covers them. */
export const ALWAYS_VISIBLE_PARTS = ['name', 'username', 'avatar'] as const;
export type ConsentScopeEntry = (typeof ALWAYS_VISIBLE_PARTS)[number] | ProfileField;

export const RELATIONSHIP_STATUSES = [
  'single',
  'in_relationship',
  'engaged',
  'married',
  'complicated',
  'searching',
] as const;
export type RelationshipStatus = (typeof RELATIONSHIP_STATUSES)[number];

export const PROFILE_TEXT_LIMITS = {
  bio: 500,
  city: 100,
  workplace: 100,
  education: 100,
  pronouns: 30,
  url: 2048,
} as const;
export const PROFILE_LINKS_MAX = 5;

export type ViewerRelation =
  'self' | 'friend' | 'fof' | 'follower' | 'stranger' | 'blocked' | 'anon';

export interface ProfileOwnerFacts {
  readonly isMinor: boolean;
  /** Account status is `active`. */
  readonly active: boolean;
  /**
   * Visible to anonymous visitors: the public-profiles flag is on, the owner is an adult, opted
   * into indexing and holds a valid dissemination consent. The API computes it.
   */
  readonly anonVisible: boolean;
}

function isM2Audience(value: unknown): value is M2FieldAudience {
  return (M2_FIELD_AUDIENCES as readonly unknown[]).includes(value);
}

/** Whether a viewer with this relation may see a field with this audience. */
export function audienceAllows(audience: FieldAudience, relation: ViewerRelation): boolean {
  if (relation === 'self') return true;
  if (relation === 'blocked') return false;
  switch (audience) {
    case 'public':
      return true;
    case 'friends':
      return relation === 'friend';
    case 'friends_of_friends':
      return relation === 'friend' || relation === 'fof';
    case 'only_me':
    case 'custom_list':
      // custom_list fails closed until friend lists exist (M3).
      return false;
  }
}

export function defaultAudience(field: ProfileField): M2FieldAudience {
  return (
    (FIELD_DEFAULT_OVERRIDES as Partial<Record<ProfileField, M2FieldAudience>>)[field] ??
    DEFAULT_FIELD_AUDIENCE
  );
}

/**
 * The audience that applies to a field. `stored` is the raw `profile_visibility_json`; missing,
 * unknown or unsupported values fall back to the field default, and a minor's field is clamped
 * to friends at most.
 */
export function effectiveAudience(
  stored: unknown,
  field: ProfileField,
  ownerIsMinor: boolean,
): M2FieldAudience {
  const raw =
    typeof stored === 'object' && stored !== null && Object.hasOwn(stored, field)
      ? (stored as Record<string, unknown>)[field]
      : undefined;
  const audience = isM2Audience(raw) ? raw : defaultAudience(field);
  if (ownerIsMinor && !(MINOR_FIELD_AUDIENCES as readonly string[]).includes(audience)) {
    return 'friends';
  }
  return audience;
}

export function effectiveAudiences(
  stored: unknown,
  ownerIsMinor: boolean,
): Record<ProfileField, M2FieldAudience> {
  return Object.fromEntries(
    PROFILE_FIELDS.map((field) => [field, effectiveAudience(stored, field, ownerIsMinor)]),
  ) as Record<ProfileField, M2FieldAudience>;
}

/** Matrix row "Profile: name, avatar, username" with the minor-owner modifier. */
export function canViewProfileHeader(relation: ViewerRelation, owner: ProfileOwnerFacts): boolean {
  if (relation === 'self') return true;
  if (!owner.active || relation === 'blocked') return false;
  if (owner.isMinor) return relation === 'friend';
  if (relation === 'anon') return owner.anonVisible;
  return true;
}

/** Fields a viewer may see (rows "Profile: other fields" and "Profile: photos"). */
export function visibleFields(
  relation: ViewerRelation,
  owner: ProfileOwnerFacts,
  stored: unknown,
): ProfileField[] {
  if (!canViewProfileHeader(relation, owner)) return [];
  return PROFILE_FIELDS.filter((field) => {
    if (relation === 'anon' && (ANON_EXCLUDED_FIELDS as readonly string[]).includes(field)) {
      return false;
    }
    return audienceAllows(effectiveAudience(stored, field, owner.isMinor), relation);
  });
}

/** Fields whose effective audience is `public`. */
export function publicFields(stored: unknown, ownerIsMinor: boolean): ProfileField[] {
  return PROFILE_FIELDS.filter(
    (field) => effectiveAudience(stored, field, ownerIsMinor) === 'public',
  );
}

/** What a dissemination consent must cover: the header plus every public field. */
export function consentScopeFor(stored: unknown, ownerIsMinor: boolean): ConsentScopeEntry[] {
  return [...ALWAYS_VISIBLE_PARTS, ...publicFields(stored, ownerIsMinor)];
}

/** Entries of `required` that `granted` does not cover. */
export function scopeNotCovered(
  required: readonly ConsentScopeEntry[],
  granted: readonly string[],
): ConsentScopeEntry[] {
  const covered = new Set(granted);
  return required.filter((entry) => !covered.has(entry));
}

export const COMPLETENESS_TEXT_FIELDS = ['bio', 'city', 'workplace', 'education'] as const;
/** Brief §1.4 activation metric: avatar plus at least two of the text fields. */
export const COMPLETENESS_MIN_TEXT_FIELDS = 2;
export type CompletenessItem = 'avatar' | (typeof COMPLETENESS_TEXT_FIELDS)[number];

export interface CompletenessInput {
  readonly hasAvatar: boolean;
  readonly bio: string | null;
  readonly city: string | null;
  readonly workplace: string | null;
  readonly education: string | null;
}

export function profileCompleteness(profile: CompletenessInput): {
  complete: boolean;
  missing: CompletenessItem[];
} {
  const emptyText = COMPLETENESS_TEXT_FIELDS.filter((field) => !profile[field]?.trim());
  const filled = COMPLETENESS_TEXT_FIELDS.length - emptyText.length;
  const missing: CompletenessItem[] = [
    ...(profile.hasAvatar ? [] : ['avatar' as const]),
    ...emptyText,
  ];
  return { complete: profile.hasAvatar && filled >= COMPLETENESS_MIN_TEXT_FIELDS, missing };
}

export type UrlProblem = 'invalid' | 'scheme' | 'credentials' | 'too_long' | 'host';
export type NormalizedUrl =
  { ok: true; url: string; host: string } | { ok: false; reason: UrlProblem };

/** `name:` at the start, where `name` has no dot (so `example.com:8080` is not a scheme). */
const EXPLICIT_SCHEME = /^([a-z][a-z0-9+.-]*):/i;
/** A hostname whose last label is all digits is an IPv4 literal (URL canonicalises them). */
const NUMERIC_LABEL = /^[0-9]+$/;

/**
 * Normalises a user-entered profile link: adds `https://` when no scheme is given, allows only
 * http and https, rejects credentials, IP literals, localhost and single-label hosts.
 * `host` is the ASCII (punycode) hostname.
 */
export function normalizeProfileUrl(input: string): NormalizedUrl {
  const trimmed = input.trim();
  if (trimmed === '') return { ok: false, reason: 'invalid' };
  if (trimmed.length > PROFILE_TEXT_LIMITS.url) return { ok: false, reason: 'too_long' };
  const scheme = EXPLICIT_SCHEME.exec(trimmed)?.[1];
  const candidate = scheme && !scheme.includes('.') ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return { ok: false, reason: 'invalid' };
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return { ok: false, reason: 'scheme' };
  if (url.username !== '' || url.password !== '') return { ok: false, reason: 'credentials' };
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (
    !host.includes('.') ||
    host.startsWith('[') ||
    NUMERIC_LABEL.test(host.slice(host.lastIndexOf('.') + 1)) ||
    host === 'localhost' ||
    host.endsWith('.localhost')
  ) {
    return { ok: false, reason: 'host' };
  }
  if (url.href.length > PROFILE_TEXT_LIMITS.url) return { ok: false, reason: 'too_long' };
  return { ok: true, url: url.href, host };
}
