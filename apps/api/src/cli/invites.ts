/**
 * Creates invite codes for invite-only registration. Safe in production: it needs only
 * DATABASE_URL, prints the codes once (only their hashes are stored) and writes an audit entry.
 *
 *   node dist/cli/invites.js --count 5 --max-uses 1 --expires-days 30 --note "beta wave 1"
 */
import pg from 'pg';
import { z } from 'zod';
import { Invites } from '../modules/auth/invites.js';
import { createDb } from '../platform/database.js';
import { audit } from '../platform/outbox.js';
import { parseInviteArgs } from './guard.js';

const options = parseInviteArgs(process.argv.slice(2).filter((arg) => arg !== '--'));
const { DATABASE_URL } = z
  .object({ DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }) })
  .parse(process.env);

const pool = new pg.Pool({
  connectionString: DATABASE_URL,
  max: 1,
  application_name: 'elega-invites',
});
try {
  const db = createDb(pool);
  const invites = new Invites();
  const expiresAt =
    options.expiresDays > 0 ? new Date(Date.now() + options.expiresDays * 86_400_000) : null;
  const codes = await db.transaction(async (tx) => {
    const created: string[] = [];
    for (let index = 0; index < options.count; index += 1) {
      created.push(
        await invites.create(tx, {
          maxUses: options.maxUses,
          expiresAt,
          note: options.note ?? 'cli',
        }),
      );
    }
    await audit(tx, {
      actorId: null,
      action: 'invite.created',
      entityType: 'invite_code',
      entityId: null,
      after: { count: options.count, maxUses: options.maxUses, expiresAt, note: options.note },
    });
    return created;
  });
  console.log(codes.join('\n'));
} finally {
  await pool.end();
}
