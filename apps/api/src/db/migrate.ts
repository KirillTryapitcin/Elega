import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type pg from 'pg';

const FILE_PATTERN = /^(\d{4})_[a-z0-9_]+\.sql$/;
const NO_TRANSACTION = '-- elega:no-transaction';
// Arbitrary constant shared by every process that migrates this database.
const LOCK_KEY = 7_406_311_101;

export interface Migration {
  version: string;
  name: string;
  sql: string;
  checksum: string;
}

export async function readMigrations(dir: string): Promise<Migration[]> {
  // `dir` comes from configuration (MIGRATIONS_DIR), never from a request.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  const migrations: Migration[] = [];
  for (const name of files) {
    const match = FILE_PATTERN.exec(name);
    if (!match?.[1]) throw new Error(`Migration file name must look like 0001_name.sql: ${name}`);
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    const sql = await readFile(join(dir, name), 'utf8');
    migrations.push({
      version: match[1],
      name,
      sql,
      checksum: createHash('sha256').update(sql).digest('hex'),
    });
  }
  const versions = new Set(migrations.map((m) => m.version));
  if (versions.size !== migrations.length) throw new Error('Duplicate migration version');
  return migrations;
}

export interface MigrateResult {
  applied: string[];
  skipped: string[];
}

/** Applies pending migrations in order. Safe to run concurrently: an advisory lock serialises runs. */
export async function migrate(
  client: pg.ClientBase,
  migrations: Migration[],
  log: (message: string) => void = () => {},
): Promise<MigrateResult> {
  await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version text PRIMARY KEY,
        name text NOT NULL,
        checksum text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )`);
    const { rows } = await client.query<{ version: string; checksum: string }>(
      'SELECT version, checksum FROM schema_migrations',
    );
    const applied = new Map(rows.map((r) => [r.version, r.checksum]));
    const result: MigrateResult = { applied: [], skipped: [] };

    for (const migration of migrations) {
      const existing = applied.get(migration.version);
      if (existing !== undefined) {
        if (existing !== migration.checksum) {
          throw new Error(`Applied migration ${migration.name} was modified (checksum mismatch)`);
        }
        result.skipped.push(migration.name);
        continue;
      }
      const transactional = !migration.sql.startsWith(NO_TRANSACTION);
      log(`applying ${migration.name}${transactional ? '' : ' (no transaction)'}`);
      try {
        if (transactional) await client.query('BEGIN');
        await client.query(migration.sql);
        await client.query(
          'INSERT INTO schema_migrations (version, name, checksum) VALUES ($1, $2, $3)',
          [migration.version, migration.name, migration.checksum],
        );
        if (transactional) await client.query('COMMIT');
      } catch (error) {
        if (transactional) await client.query('ROLLBACK');
        throw new Error(`Migration ${migration.name} failed`, { cause: error });
      }
      result.applied.push(migration.name);
    }
    return result;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]);
  }
}
