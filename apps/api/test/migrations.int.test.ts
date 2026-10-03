import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrate, readMigrations, type MigrateResult, type Migration } from '../src/db/migrate.js';

const MIGRATIONS = fileURLToPath(new URL('../migrations', import.meta.url));
const M1_VERSION = '0001';
const M2_VERSION = '0002';
const M2_FILE = '0002_profiles_media.sql';

// Postgres SQLSTATE codes.
const CHECK_VIOLATION = '23514';
const NOT_NULL_VIOLATION = '23502';
const FOREIGN_KEY_VIOLATION = '23503';

/** 0002's CHECK limits; PROFILE_TEXT_LIMITS and PROFILE_LINKS_MAX in @elega/shared must agree. */
const PROFILE_TEXT_LIMITS = {
  city: 100,
  workplace: 100,
  education: 100,
  pronouns: 30,
  website: 2048,
} as const;
const PROFILE_LINKS_MAX = 5;
/** media.storage_key is a 128-bit random root, hex-encoded. */
const STORAGE_ROOT_BYTES = 16;
const MINOR_AGE_YEARS = 15;
const ADULT_BIRTHDATE = '1990-05-01';
const LEGAL_VERSION = '2026-01-01';

/** The rollback documented in docs/database.md, statement for statement. */
const ROLLBACK_0002 = `
BEGIN;

DROP INDEX consents_user_type_idx;
ALTER TABLE consents DROP CONSTRAINT consents_scope_chk;
ALTER TABLE consents DROP COLUMN scope_json;
DELETE FROM consents WHERE type = 'pd_dissemination';
ALTER TABLE consents DROP CONSTRAINT consents_type_check;
ALTER TABLE consents ADD CONSTRAINT consents_type_check CHECK (type IN
  ('terms', 'privacy', 'pd_processing', 'marketing', 'cookies_analytics'));

ALTER TABLE user_settings
  DROP COLUMN onboarding_done,
  DROP COLUMN profile_hint_dismissed;

ALTER TABLE user_profiles
  DROP CONSTRAINT user_profiles_links_arr,
  DROP CONSTRAINT user_profiles_visibility_obj,
  DROP CONSTRAINT user_profiles_relationship_chk,
  DROP CONSTRAINT user_profiles_country_chk,
  DROP CONSTRAINT user_profiles_website_len,
  DROP CONSTRAINT user_profiles_pronouns_len,
  DROP CONSTRAINT user_profiles_education_len,
  DROP CONSTRAINT user_profiles_workplace_len,
  DROP CONSTRAINT user_profiles_city_len;

ALTER TABLE media DROP CONSTRAINT media_owner_fk;
ALTER TABLE media ADD CONSTRAINT media_owner_fk FOREIGN KEY (owner_id) REFERENCES users (id) ON DELETE CASCADE;
DROP INDEX media_rejected_idx, media_deleted_idx, media_pending_idx, media_owner_purpose_idx;
ALTER TABLE media
  DROP CONSTRAINT media_storage_key_chk,
  DROP CONSTRAINT media_rejection_reason_chk,
  DROP COLUMN process_attempts,
  DROP COLUMN rejection_reason,
  DROP COLUMN purpose;

DELETE FROM schema_migrations WHERE version = '0002';

COMMIT;
`;

let postgres: StartedPostgreSqlContainer;
let client: pg.Client;
let all: Migration[];
let m1Schema: SchemaSnapshot;
let upgrade: MigrateResult;
const m1Users = { adultIndexed: '', adultPrivate: '', minor: '' };

const upTo = (version: string) => all.filter((m) => m.version <= version);
const newRoot = () => randomBytes(STORAGE_ROOT_BYTES).toString('hex');

interface SchemaSnapshot {
  columns: unknown[];
  constraints: unknown[];
  indexes: unknown[];
}

/** Columns, constraints and indexes of the public schema, in a stable order. */
async function schemaSnapshot(): Promise<SchemaSnapshot> {
  const columns = await client.query(
    `SELECT table_name, column_name, data_type, udt_name, is_nullable, column_default
       FROM information_schema.columns WHERE table_schema = 'public'
      ORDER BY table_name, column_name`,
  );
  const constraints = await client.query(
    `SELECT conrelid::regclass::text AS table_name, conname, pg_get_constraintdef(oid) AS definition
       FROM pg_constraint WHERE connamespace = 'public'::regnamespace
      ORDER BY 1, 2`,
  );
  const indexes = await client.query(
    `SELECT tablename, indexname, indexdef FROM pg_indexes WHERE schemaname = 'public'
      ORDER BY tablename, indexname`,
  );
  return { columns: columns.rows, constraints: constraints.rows, indexes: indexes.rows };
}

/** What an M1 sign-up wrote (accounts.service.ts): user, empty profile, settings, consents. */
async function seedM1User(username: string, birthdate: string, indexing: boolean) {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO users (email, email_verified_at, password_hash, username, display_name, birthdate)
     VALUES ($1, now(), 'not-a-real-hash', $2, $3, $4) RETURNING id`,
    [`${username}@m1.elega.test`, username, username, birthdate],
  );
  const id = rows[0]?.id;
  if (!id) throw new Error('user insert returned nothing');
  await client.query('INSERT INTO user_profiles (user_id) VALUES ($1)', [id]);
  await client.query(
    'INSERT INTO user_settings (user_id, search_engine_indexing) VALUES ($1, $2)',
    [id, indexing],
  );
  await client.query(
    `INSERT INTO consents (user_id, type, version)
     SELECT $1, t, $2 FROM unnest(ARRAY['terms', 'privacy', 'pd_processing']) AS t`,
    [id, LEGAL_VERSION],
  );
  return id;
}

/** Runs a statement that must fail, inside a savepoint so the open transaction survives. */
async function expectViolation(
  statement: string,
  params: unknown[],
  error: { code: string; constraint?: string },
) {
  await client.query('SAVEPOINT probe');
  await expect(client.query(statement, params)).rejects.toMatchObject(error);
  await client.query('ROLLBACK TO SAVEPOINT probe');
}

async function expectCheck(statement: string, params: unknown[], constraint: string) {
  await expectViolation(statement, params, { code: CHECK_VIOLATION, constraint });
}

beforeAll(async () => {
  postgres = await new PostgreSqlContainer(
    process.env.TEST_POSTGRES_IMAGE ?? 'postgres:16-alpine',
  ).start();
  client = new pg.Client({ connectionString: postgres.getConnectionUri() });
  await client.connect();
  all = await readMigrations(MIGRATIONS);
  await migrate(client, upTo(M1_VERSION));

  const minorBirthdate = new Date();
  minorBirthdate.setUTCFullYear(minorBirthdate.getUTCFullYear() - MINOR_AGE_YEARS);
  m1Users.adultIndexed = await seedM1User('m1.indexed', ADULT_BIRTHDATE, true);
  m1Users.adultPrivate = await seedM1User('m1.private', ADULT_BIRTHDATE, false);
  m1Users.minor = await seedM1User('m1.minor', minorBirthdate.toISOString().slice(0, 10), false);
  // Cookie consent recorded before sign-up.
  await client.query(
    "INSERT INTO consents (anonymous_id, type, version) VALUES (gen_random_uuid(), 'cookies_analytics', $1)",
    [LEGAL_VERSION],
  );
  m1Schema = await schemaSnapshot();

  upgrade = await migrate(client, upTo(M2_VERSION));
});

afterAll(async () => {
  await client?.end();
  await postgres?.stop();
});

// The steps share one database and run in order: upgrade, checks, rollback, re-apply.
describe('migration 0002 on a database holding M1 data', () => {
  it('applies only 0002', () => {
    expect(upgrade).toEqual({ applied: [M2_FILE], skipped: ['0001_initial_schema.sql'] });
  });

  it('turns off indexing that M1 enabled without an Art. 10.1 consent, keeping other data', async () => {
    const { rows: settings } = await client.query<{
      user_id: string;
      search_engine_indexing: boolean;
      profile_hint_dismissed: boolean;
      onboarding_done: boolean;
    }>(
      'SELECT user_id, search_engine_indexing, profile_hint_dismissed, onboarding_done FROM user_settings',
    );
    expect(settings).toHaveLength(Object.keys(m1Users).length);
    for (const row of settings) {
      expect(row).toMatchObject({
        search_engine_indexing: false,
        profile_hint_dismissed: false,
        onboarding_done: false,
      });
    }

    const { rows: profiles } = await client.query(
      'SELECT profile_visibility_json, links_json, country FROM user_profiles',
    );
    expect(profiles).toEqual(
      Object.keys(m1Users).map(() => ({
        profile_visibility_json: {},
        links_json: [],
        country: null,
      })),
    );

    const { rows: consents } = await client.query<{ type: string; n: number }>(
      `SELECT type, count(*)::int AS n FROM consents
        WHERE scope_json IS NULL AND revoked_at IS NULL GROUP BY type ORDER BY type`,
    );
    const users = Object.keys(m1Users).length;
    expect(consents).toEqual([
      { type: 'cookies_analytics', n: 1 },
      { type: 'pd_processing', n: users },
      { type: 'privacy', n: users },
      { type: 'terms', n: users },
    ]);
  });

  it('adds the constraints, indexes and a restrictive media owner key', async () => {
    const { rows: constraints } = await client.query<{ conname: string }>(
      `SELECT conname FROM pg_constraint
        WHERE conrelid IN ('media'::regclass, 'user_profiles'::regclass, 'consents'::regclass)`,
    );
    expect(constraints.map((c) => c.conname)).toEqual(
      expect.arrayContaining([
        'media_purpose_check',
        'media_rejection_reason_check',
        'media_rejection_reason_chk',
        'media_process_attempts_check',
        'media_storage_key_chk',
        'media_owner_fk',
        'user_profiles_city_len',
        'user_profiles_workplace_len',
        'user_profiles_education_len',
        'user_profiles_pronouns_len',
        'user_profiles_website_len',
        'user_profiles_country_chk',
        'user_profiles_relationship_chk',
        'user_profiles_visibility_obj',
        'user_profiles_links_arr',
        'consents_type_check',
        'consents_scope_chk',
      ]),
    );

    const { rows: indexes } = await client.query<{ indexname: string }>(
      "SELECT indexname FROM pg_indexes WHERE tablename IN ('media', 'consents')",
    );
    expect(indexes.map((i) => i.indexname)).toEqual(
      expect.arrayContaining([
        'media_owner_purpose_idx',
        'media_pending_idx',
        'media_deleted_idx',
        'media_rejected_idx',
        'media_orphans_idx',
        'consents_user_type_idx',
      ]),
    );

    const { rows: fk } = await client.query<{ confdeltype: string }>(
      "SELECT confdeltype FROM pg_constraint WHERE conname = 'media_owner_fk'",
    );
    // 'r' = RESTRICT (0001 had 'c' = CASCADE).
    expect(fk).toEqual([{ confdeltype: 'r' }]);
  });

  it('enforces the new media rules', async () => {
    const owner = m1Users.adultPrivate;
    const insert = `INSERT INTO media (owner_id, kind, purpose, storage_key, status, rejection_reason, process_attempts)
                    VALUES ($1, 'image', $2, $3, $4, $5, $6)`;
    const row = (r: {
      purpose?: string;
      key?: string;
      status?: string;
      reason?: string;
      attempts?: number;
    }) => [
      owner,
      r.purpose ?? 'avatar',
      r.key ?? newRoot(),
      r.status ?? 'pending',
      r.reason ?? null,
      r.attempts ?? 0,
    ];

    await client.query('BEGIN');
    try {
      await expectViolation(
        "INSERT INTO media (owner_id, kind, storage_key) VALUES ($1, 'image', $2)",
        [owner, newRoot()],
        { code: NOT_NULL_VIOLATION },
      );
      await expectCheck(insert, row({ purpose: 'export' }), 'media_purpose_check');
      await expectCheck(insert, row({ key: 'u/avatars/photo.jpg' }), 'media_storage_key_chk');
      await expectCheck(insert, row({ key: newRoot().toUpperCase() }), 'media_storage_key_chk');
      await expectCheck(insert, row({ key: `${newRoot()}0` }), 'media_storage_key_chk');
      await expectCheck(insert, row({ status: 'rejected' }), 'media_rejection_reason_chk');
      await expectCheck(
        insert,
        row({ status: 'ready', reason: 'corrupt' }),
        'media_rejection_reason_chk',
      );
      await expectCheck(
        insert,
        row({ status: 'rejected', reason: 'too_ugly' }),
        'media_rejection_reason_check',
      );
      await expectCheck(insert, row({ attempts: -1 }), 'media_process_attempts_check');

      await client.query(insert, row({ purpose: 'cover' }));
      await client.query(insert, row({ status: 'rejected', reason: 'malware' }));
      // Users with media cannot be hard-deleted before the media is purged.
      await expectViolation('DELETE FROM users WHERE id = $1', [owner], {
        code: FOREIGN_KEY_VIOLATION,
        constraint: 'media_owner_fk',
      });
    } finally {
      await client.query('ROLLBACK');
    }
  });

  it('enforces the new profile rules', async () => {
    const owner = m1Users.adultPrivate;
    await client.query('BEGIN');
    try {
      for (const [field, limit] of Object.entries(PROFILE_TEXT_LIMITS)) {
        const update = `UPDATE user_profiles SET ${field} = $2 WHERE user_id = $1`;
        await client.query(update, [owner, 'x'.repeat(limit)]);
        await expectCheck(update, [owner, 'x'.repeat(limit + 1)], `user_profiles_${field}_len`);
      }

      const set = (column: string) => `UPDATE user_profiles SET ${column} = $2 WHERE user_id = $1`;
      await client.query(set('country'), [owner, 'RU']);
      await expectCheck(set('country'), [owner, 'ru'], 'user_profiles_country_chk');
      await expectCheck(set('country'), [owner, 'RUS'], 'user_profiles_country_chk');
      await client.query(set('relationship_status'), [owner, 'married']);
      await expectCheck(
        set('relationship_status'),
        [owner, 'widowed'],
        'user_profiles_relationship_chk',
      );
      await client.query(set('profile_visibility_json'), [owner, { city: 'friends' }]);
      await expectCheck(
        set('profile_visibility_json'),
        [owner, JSON.stringify(['friends'])],
        'user_profiles_visibility_obj',
      );

      const links = (n: number) =>
        JSON.stringify(Array.from({ length: n }, (_, i) => `https://example.com/${i}`));
      await client.query(set('links_json'), [owner, links(PROFILE_LINKS_MAX)]);
      await expectCheck(
        set('links_json'),
        [owner, links(PROFILE_LINKS_MAX + 1)],
        'user_profiles_links_arr',
      );
      await expectCheck(
        set('links_json'),
        [owner, { url: 'https://example.com' }],
        'user_profiles_links_arr',
      );
    } finally {
      await client.query('ROLLBACK');
    }
  });

  it('accepts dissemination consents only with a recorded scope', async () => {
    const owner = m1Users.adultIndexed;
    const insert =
      'INSERT INTO consents (user_id, type, version, scope_json) VALUES ($1, $2, $3, $4)';
    const scope = { fields: ['name', 'username', 'avatar', 'bio'] };
    await client.query('BEGIN');
    try {
      await client.query(insert, [owner, 'pd_dissemination', LEGAL_VERSION, scope]);
      await expectCheck(
        insert,
        [owner, 'pd_dissemination', LEGAL_VERSION, null],
        'consents_scope_chk',
      );
      await expectCheck(
        insert,
        [owner, 'pd_dissemination', LEGAL_VERSION, { fields: 'bio' }],
        'consents_scope_chk',
      );
      await expectCheck(
        insert,
        [owner, 'pd_dissemination', LEGAL_VERSION, {}],
        'consents_scope_chk',
      );
      await expectCheck(insert, [owner, 'terms', LEGAL_VERSION, scope], 'consents_scope_chk');
      await expectCheck(insert, [owner, 'newsletter', LEGAL_VERSION, null], 'consents_type_check');
    } finally {
      await client.query('ROLLBACK');
    }
  });

  it('running the migrations again changes nothing', async () => {
    const before = await schemaSnapshot();
    expect(await migrate(client, upTo(M2_VERSION))).toEqual({
      applied: [],
      skipped: upTo(M2_VERSION).map((m) => m.name),
    });
    expect(await schemaSnapshot()).toEqual(before);
  });

  it('the documented rollback restores the 0001 schema, and 0002 applies again', async () => {
    // A dissemination consent exists, as it would in production; the rollback deletes it.
    await client.query(
      "INSERT INTO consents (user_id, type, version, scope_json) VALUES ($1, 'pd_dissemination', $2, $3)",
      [m1Users.adultIndexed, LEGAL_VERSION, { fields: ['name', 'username', 'avatar'] }],
    );
    const upgraded = await schemaSnapshot();

    await client.query(ROLLBACK_0002);
    expect(await schemaSnapshot()).toEqual(m1Schema);
    const { rows: versions } = await client.query<{ version: string }>(
      'SELECT version FROM schema_migrations ORDER BY version',
    );
    expect(versions).toEqual([{ version: M1_VERSION }]);

    expect(await migrate(client, upTo(M2_VERSION))).toMatchObject({ applied: [M2_FILE] });
    expect(await schemaSnapshot()).toEqual(upgraded);
  });

  it('the full migration list applies on top and is idempotent', async () => {
    const first = await migrate(client, all);
    expect(first.applied).toEqual(all.filter((m) => m.version > M2_VERSION).map((m) => m.name));
    const second = await migrate(client, all);
    expect(second).toEqual({ applied: [], skipped: all.map((m) => m.name) });
  });
});
