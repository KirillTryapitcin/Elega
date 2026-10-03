import { Injectable } from '@nestjs/common';
import { and, eq, gt, inArray, isNull } from 'drizzle-orm';
import { emailTokens, type EmailTokenType } from '../../db/schema.js';
import { randomToken, sha256 } from '../../platform/crypto.js';
import type { Executor } from '../../platform/database.js';

const HOUR_MS = 3_600_000;
/** Brief §8.1 and §8.5: verification 24 h, reset 1 h. Email change follows verification. */
export const EMAIL_TOKEN_TTL_MS: Record<EmailTokenType, number> = {
  verify_email: 24 * HOUR_MS,
  change_email: 24 * HOUR_MS,
  reset_password: HOUR_MS,
};

export type EmailTokenRow = typeof emailTokens.$inferSelect;

/** Single-use tokens sent by email; only the SHA-256 is stored. */
@Injectable()
export class EmailTokens {
  /** Issues a token and invalidates earlier unused tokens of the same type for the user. */
  async issue(
    db: Executor,
    userId: string,
    type: EmailTokenType,
    newEmail?: string,
  ): Promise<string> {
    await this.invalidate(db, userId, type);
    const token = randomToken();
    await db.insert(emailTokens).values({
      userId,
      type,
      tokenHash: sha256(token),
      newEmail: newEmail ?? null,
      expiresAt: new Date(Date.now() + EMAIL_TOKEN_TTL_MS[type]),
    });
    return token;
  }

  async invalidate(db: Executor, userId: string, type: EmailTokenType): Promise<void> {
    await db
      .update(emailTokens)
      .set({ usedAt: new Date() })
      .where(
        and(eq(emailTokens.userId, userId), eq(emailTokens.type, type), isNull(emailTokens.usedAt)),
      );
  }

  /** Marks the token used and returns it, or null when unknown, used or expired. */
  async consume(
    db: Executor,
    token: string,
    types: readonly EmailTokenType[],
  ): Promise<EmailTokenRow | null> {
    const [row] = await db
      .update(emailTokens)
      .set({ usedAt: new Date() })
      .where(
        and(
          eq(emailTokens.tokenHash, sha256(token)),
          inArray(emailTokens.type, [...types]),
          isNull(emailTokens.usedAt),
          gt(emailTokens.expiresAt, new Date()),
        ),
      )
      .returning();
    return row ?? null;
  }
}
