import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { and, eq, gt, isNull, lt, or, sql } from 'drizzle-orm';
import { inviteCodes } from '../../db/schema.js';
import { sha256 } from '../../platform/crypto.js';
import type { Executor } from '../../platform/database.js';

// Unambiguous characters for codes people type in (no 0/O, 1/I/L).
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** Normalises user input: case-insensitive, dashes and spaces ignored. */
export function normalizeInviteCode(code: string): string {
  return code.toUpperCase().replace(/[\s-]/g, '');
}

/** A 16-character code (about 79 bits), shown as XXXX-XXXX-XXXX-XXXX. */
export function generateInviteCode(): string {
  const bytes = randomBytes(16);
  const chars = [...bytes].map((byte) => ALPHABET[byte % ALPHABET.length]).join('');
  return chars.match(/.{4}/g)!.join('-');
}

/** Invite-only registration until open beta (brief §37.3). Codes are stored hashed. */
@Injectable()
export class Invites {
  async create(
    db: Executor,
    options: {
      maxUses?: number;
      expiresAt?: Date | null;
      note?: string;
      createdBy?: string | null;
    },
  ): Promise<string> {
    const code = generateInviteCode();
    await db.insert(inviteCodes).values({
      codeHash: sha256(normalizeInviteCode(code)),
      maxUses: options.maxUses ?? 1,
      expiresAt: options.expiresAt ?? null,
      note: options.note ?? null,
      createdBy: options.createdBy ?? null,
    });
    return code;
  }

  /** Atomically takes one use of the code. Returns its id, or null if invalid or used up. */
  async redeem(db: Executor, code: string): Promise<string | null> {
    const [row] = await db
      .update(inviteCodes)
      .set({ usedCount: sql`${inviteCodes.usedCount} + 1` })
      .where(
        and(
          eq(inviteCodes.codeHash, sha256(normalizeInviteCode(code))),
          lt(inviteCodes.usedCount, inviteCodes.maxUses),
          or(isNull(inviteCodes.expiresAt), gt(inviteCodes.expiresAt, new Date())),
        ),
      )
      .returning({ id: inviteCodes.id });
    return row?.id ?? null;
  }
}
