/**
 * Turns a feature flag on or off, for example the upload kill switch. An ops tool, so it runs in
 * production too: it needs only DATABASE_URL, accepts only known flag keys and writes an audit
 * entry. API processes pick the change up within 30 seconds (their flag cache), the media
 * worker within its poll interval.
 *
 *   node dist/cli/flags.js set media.uploads_paused on
 *   pnpm --filter @elega/api flags set profiles.public_access off
 */
import pg from 'pg';
import { z } from 'zod';
import { createDb } from '../platform/database.js';
import { parseFlagArgs, setFlag } from './flag-command.js';

const EXIT_USAGE = 2;

let command: ReturnType<typeof parseFlagArgs>;
try {
  command = parseFlagArgs(process.argv.slice(2).filter((arg) => arg !== '--'));
} catch (error) {
  console.error((error as Error).message);
  process.exit(EXIT_USAGE);
}
const env = z
  .object({ DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }) })
  .safeParse(process.env);
if (!env.success) {
  // Never echo the value: it carries the database password.
  console.error('DATABASE_URL must be set to a postgres:// URL; refusing to run without it');
  process.exit(EXIT_USAGE);
}

const pool = new pg.Pool({
  connectionString: env.data.DATABASE_URL,
  max: 1,
  application_name: 'elega-flags',
});
try {
  const change = await setFlag(createDb(pool), command);
  const state = (on: boolean) => (on ? 'on' : 'off');
  console.log(`${change.key}: ${state(change.wasEnabled)} -> ${state(change.enabled)}`);
} finally {
  await pool.end();
}
