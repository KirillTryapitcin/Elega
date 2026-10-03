/**
 * Drizzle table definitions for the tables the API reads and writes. The SQL migrations in
 * apps/api/migrations are the source of truth; test/schema.int.test.ts fails when a column
 * here does not exist in the migrated database. Tables are added as milestones need them.
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  customType,
  date,
  integer,
  jsonb,
  numeric,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

const citext = customType<{ data: string }>({ dataType: () => 'citext' });
const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'bytea' });

const tz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const id = () =>
  uuid('id')
    .primaryKey()
    .default(sql`uuid_generate_v7()`);
const stamps = {
  createdAt: tz('created_at').notNull().defaultNow(),
  updatedAt: tz('updated_at').notNull().defaultNow(),
};

export type UserStatus = 'active' | 'suspended' | 'pending_deletion' | 'banned';
export type UserRole = 'user' | 'moderator' | 'analyst' | 'admin';
export type Locale = 'ru' | 'en';
export type AuthProvider = 'password' | 'vk' | 'yandex' | 'google';
export type EmailTokenType = 'verify_email' | 'reset_password' | 'change_email';

export const users = pgTable('users', {
  id: id(),
  email: citext('email').notNull(),
  emailVerifiedAt: tz('email_verified_at'),
  passwordHash: text('password_hash'),
  username: citext('username').notNull(),
  displayName: text('display_name').notNull(),
  status: text('status').$type<UserStatus>().notNull().default('active'),
  role: text('role').$type<UserRole>().notNull().default('user'),
  trustLevel: smallint('trust_level').notNull().default(0),
  locale: text('locale').$type<Locale>().notNull().default('ru'),
  timezone: text('timezone').notNull().default('Europe/Moscow'),
  birthdate: date('birthdate', { mode: 'string' }).notNull(),
  adultFrom: date('adult_from', { mode: 'string' }).generatedAlwaysAs(
    sql`((birthdate + interval '18 years')::date)`,
  ),
  invitedByCodeId: uuid('invited_by_code_id'),
  lastSeenAt: tz('last_seen_at'),
  deletionScheduledAt: tz('deletion_scheduled_at'),
  ...stamps,
});

export const userProfiles = pgTable('user_profiles', {
  userId: uuid('user_id').primaryKey(),
  bio: text('bio'),
  city: text('city'),
  workplace: text('workplace'),
  education: text('education'),
  website: text('website'),
  pronouns: text('pronouns'),
  relationshipStatus: text('relationship_status'),
  profileVisibilityJson: jsonb('profile_visibility_json')
    .$type<Record<string, string>>()
    .notNull()
    .default({}),
  linksJson: jsonb('links_json').$type<string[]>().notNull().default([]),
  ...stamps,
});

export const userSettings = pgTable('user_settings', {
  userId: uuid('user_id').primaryKey(),
  theme: text('theme').$type<'light' | 'dark' | 'system'>().notNull().default('system'),
  fontScale: numeric('font_scale', { precision: 3, scale: 2, mode: 'number' }).notNull().default(1),
  feedMode: text('feed_mode')
    .$type<'chronological' | 'for_you'>()
    .notNull()
    .default('chronological'),
  whoCanMessage: text('who_can_message')
    .$type<'everyone' | 'friends' | 'nobody'>()
    .notNull()
    .default('everyone'),
  whoCanSendFriendRequests: text('who_can_send_friend_requests')
    .$type<'everyone' | 'friends_of_friends' | 'nobody'>()
    .notNull()
    .default('everyone'),
  whoCanSeeOnlineStatus: text('who_can_see_online_status')
    .$type<'everyone' | 'friends' | 'nobody'>()
    .notNull()
    .default('friends'),
  whoCanMention: text('who_can_mention')
    .$type<'everyone' | 'friends' | 'nobody'>()
    .notNull()
    .default('everyone'),
  allowFollowers: boolean('allow_followers').notNull().default(true),
  readReceiptsEnabled: boolean('read_receipts_enabled').notNull().default(true),
  defaultPostAudience: text('default_post_audience')
    .$type<'public' | 'friends' | 'close_friends' | 'only_me'>()
    .notNull()
    .default('friends'),
  searchEngineIndexing: boolean('search_engine_indexing').notNull().default(false),
  discoverableByEmail: boolean('discoverable_by_email').notNull().default(false),
  dataSaver: boolean('data_saver').notNull().default(false),
  ...stamps,
});

export const authCredentials = pgTable('auth_credentials', {
  id: id(),
  userId: uuid('user_id').notNull(),
  provider: text('provider').$type<AuthProvider>().notNull(),
  providerUserId: text('provider_user_id').notNull(),
  ...stamps,
});

export const sessions = pgTable('sessions', {
  id: id(),
  userId: uuid('user_id').notNull(),
  familyId: uuid('family_id').notNull(),
  refreshTokenHash: bytea('refresh_token_hash').notNull(),
  deviceName: text('device_name'),
  userAgent: text('user_agent'),
  ipHash: bytea('ip_hash'),
  coarseLocation: text('coarse_location'),
  rememberDevice: boolean('remember_device').notNull().default(false),
  lastUsedAt: tz('last_used_at').notNull().defaultNow(),
  expiresAt: tz('expires_at').notNull(),
  revokedAt: tz('revoked_at'),
  rotatedFromId: uuid('rotated_from_id'),
  ...stamps,
});

export const emailTokens = pgTable('email_tokens', {
  id: id(),
  userId: uuid('user_id').notNull(),
  type: text('type').$type<EmailTokenType>().notNull(),
  tokenHash: bytea('token_hash').notNull(),
  newEmail: citext('new_email'),
  expiresAt: tz('expires_at').notNull(),
  usedAt: tz('used_at'),
  ...stamps,
});

export const totpSecrets = pgTable('totp_secrets', {
  userId: uuid('user_id').primaryKey(),
  secretEncrypted: bytea('secret_encrypted').notNull(),
  keyVersion: smallint('key_version').notNull(),
  confirmedAt: tz('confirmed_at'),
  recoveryCodesHash: bytea('recovery_codes_hash')
    .array()
    .notNull()
    .default(sql`'{}'`),
  ...stamps,
});

export const loginAttempts = pgTable('login_attempts', {
  id: id(),
  identifierHash: bytea('identifier_hash').notNull(),
  ipHash: bytea('ip_hash').notNull(),
  success: boolean('success').notNull(),
  ...stamps,
});

export const inviteCodes = pgTable('invite_codes', {
  id: id(),
  codeHash: bytea('code_hash').notNull(),
  createdBy: uuid('created_by'),
  maxUses: integer('max_uses').notNull().default(1),
  usedCount: integer('used_count').notNull().default(0),
  expiresAt: tz('expires_at'),
  note: text('note'),
  ...stamps,
});

export const usernameHistory = pgTable('username_history', {
  username: citext('username').primaryKey(),
  userId: uuid('user_id').notNull(),
  releasedAt: tz('released_at').notNull().defaultNow(),
  redirectUntil: tz('redirect_until').notNull(),
  ...stamps,
});

export const consents = pgTable('consents', {
  id: id(),
  userId: uuid('user_id'),
  anonymousId: uuid('anonymous_id'),
  type: text('type')
    .$type<'terms' | 'privacy' | 'pd_processing' | 'marketing' | 'cookies_analytics'>()
    .notNull(),
  version: text('version').notNull(),
  grantedAt: tz('granted_at').notNull().defaultNow(),
  revokedAt: tz('revoked_at'),
  ipHash: bytea('ip_hash'),
  ...stamps,
});

export const outbox = pgTable('outbox', {
  id: id(),
  aggregateType: text('aggregate_type').notNull(),
  aggregateId: uuid('aggregate_id').notNull(),
  eventType: text('event_type').notNull(),
  eventVersion: smallint('event_version').notNull().default(1),
  payloadJson: jsonb('payload_json').$type<Record<string, unknown>>().notNull(),
  publishedAt: tz('published_at'),
  attempts: integer('attempts').notNull().default(0),
  ...stamps,
});

export const auditLog = pgTable('audit_log', {
  id: id(),
  actorId: uuid('actor_id'),
  action: text('action').notNull(),
  entityType: text('entity_type').notNull(),
  entityId: uuid('entity_id'),
  beforeJson: jsonb('before_json'),
  afterJson: jsonb('after_json'),
  justification: text('justification'),
  ipHash: bytea('ip_hash'),
  userAgent: text('user_agent'),
  ...stamps,
});

export const blockedDomains = pgTable('blocked_domains', {
  domain: citext('domain').primaryKey(),
  reason: text('reason'),
  ...stamps,
});

export const featureFlags = pgTable('feature_flags', {
  key: text('key').primaryKey(),
  enabled: boolean('enabled').notNull().default(false),
  rolloutPercent: smallint('rollout_percent').notNull().default(0),
  rulesJson: jsonb('rules_json').notNull().default({}),
  description: text('description'),
  ...stamps,
});
