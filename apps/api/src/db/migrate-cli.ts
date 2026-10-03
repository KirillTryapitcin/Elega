import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { z } from 'zod';
import { migrate, readMigrations } from './migrate.js';

const { DATABASE_URL, MIGRATIONS_DIR } = z
  .object({
    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    MIGRATIONS_DIR: z.string().default(fileURLToPath(new URL('../../migrations', import.meta.url))),
  })
  .parse(process.env);

const client = new pg.Client({ connectionString: DATABASE_URL, application_name: 'elega-migrate' });
await client.connect();
try {
  const result = await migrate(client, await readMigrations(MIGRATIONS_DIR), (m) =>
    console.log(`[migrate] ${m}`),
  );
  console.log(
    `[migrate] done: ${result.applied.length} applied, ${result.skipped.length} already applied`,
  );
} finally {
  await client.end();
}
