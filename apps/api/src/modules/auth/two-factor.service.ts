import { createCipheriv, createDecipheriv, randomBytes, randomInt } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import { Secret, TOTP } from 'otpauth';
import QRCode from 'qrcode';
import { totpSecrets } from '../../db/schema.js';
import { KEYRING, type Keyring, safeEqual, sha256 } from '../../platform/crypto.js';
import { DB, type Db, type Executor } from '../../platform/database.js';
import { AppError } from '../../platform/errors/app-error.js';
import { REDIS } from '../../platform/redis.js';

const ISSUER = 'Elega';
const PERIOD_SEC = 30;
const RECOVERY_CODE_COUNT = 10;
const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** AES-256-GCM: [12-byte IV][16-byte tag][ciphertext]; the key version is stored alongside. */
function encrypt(key: Buffer, plain: Buffer): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]);
}

function decrypt(key: Buffer, sealed: Buffer): Buffer {
  const decipher = createDecipheriv('aes-256-gcm', key, sealed.subarray(0, 12));
  decipher.setAuthTag(sealed.subarray(12, 28));
  return Buffer.concat([decipher.update(sealed.subarray(28)), decipher.final()]);
}

/** node-postgres cannot serialise Buffer[] as bytea[]; build the array literal in SQL. */
function byteaArray(values: Buffer[]) {
  return sql`ARRAY[${sql.join(
    values.map((value) => sql`${value}`),
    sql`, `,
  )}]::bytea[]`;
}

function recoveryCode(): string {
  return Array.from(
    { length: 10 },
    () => RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)],
  ).join('');
}

/** TOTP with QR enrolment and 10 one-time recovery codes (brief §8.7). */
@Injectable()
export class TwoFactorService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(KEYRING) private readonly keyring: Keyring,
  ) {}

  async isEnabled(userId: string, db: Executor = this.db): Promise<boolean> {
    const [row] = await db
      .select({ confirmedAt: totpSecrets.confirmedAt })
      .from(totpSecrets)
      .where(eq(totpSecrets.userId, userId));
    return Boolean(row?.confirmedAt);
  }

  /** Starts enrolment with a fresh secret. Refused while 2FA is already on. */
  async setup(
    userId: string,
    accountLabel: string,
  ): Promise<{ otpauthUrl: string; qrSvg: string }> {
    if (await this.isEnabled(userId)) {
      throw new AppError('conflict', 'Two-factor authentication is already on');
    }
    const secret = new Secret({ size: 20 });
    const [key] = this.keyring.totp;
    if (!key) throw new Error('No TOTP encryption key configured');
    const sealed = encrypt(key.key, Buffer.from(secret.bytes));
    await this.db
      .insert(totpSecrets)
      .values({ userId, secretEncrypted: sealed, keyVersion: key.version })
      .onConflictDoUpdate({
        target: totpSecrets.userId,
        set: {
          secretEncrypted: sealed,
          keyVersion: key.version,
          confirmedAt: null,
          recoveryCodesHash: sql`'{}'::bytea[]`,
        },
      });
    const otpauthUrl = this.totp(secret, accountLabel).toString();
    const qrSvg = await QRCode.toString(otpauthUrl, {
      type: 'svg',
      errorCorrectionLevel: 'M',
      margin: 1,
    });
    return { otpauthUrl, qrSvg };
  }

  /** Confirms enrolment with a current code and returns the recovery codes, shown once. */
  async confirm(userId: string, code: string): Promise<string[]> {
    const [row] = await this.db.select().from(totpSecrets).where(eq(totpSecrets.userId, userId));
    if (!row)
      throw new AppError('validation_failed', 'Start setup first', [
        { field: 'code', message: 'setup_required' },
      ]);
    if (row.confirmedAt) throw new AppError('conflict', 'Two-factor authentication is already on');
    if (!(await this.checkTotp(userId, row, code))) {
      throw new AppError('validation_failed', 'Wrong code', [
        { field: 'code', message: 'code_invalid' },
      ]);
    }
    const codes = Array.from({ length: RECOVERY_CODE_COUNT }, recoveryCode);
    await this.db
      .update(totpSecrets)
      .set({
        confirmedAt: new Date(),
        recoveryCodesHash: byteaArray(codes.map((value) => sha256(value))),
      })
      .where(eq(totpSecrets.userId, userId));
    return codes;
  }

  async disable(db: Executor, userId: string): Promise<void> {
    await db.delete(totpSecrets).where(eq(totpSecrets.userId, userId));
  }

  /**
   * Checks a TOTP code (each time step accepted once) or a recovery code (consumed on use).
   * Returns false when 2FA is off.
   */
  async verify(userId: string, code: string): Promise<boolean> {
    const [row] = await this.db.select().from(totpSecrets).where(eq(totpSecrets.userId, userId));
    if (!row?.confirmedAt) return false;
    const normalized = code.replace(/[\s-]/g, '').toUpperCase();
    if (/^[0-9]{6}$/.test(normalized)) return this.checkTotp(userId, row, normalized);
    if (!/^[A-Z0-9]{10}$/.test(normalized)) return false;
    const hash = sha256(normalized);
    const match = row.recoveryCodesHash.find((candidate) => safeEqual(candidate, hash));
    if (!match) return false;
    // Remove exactly this code; concurrent use of the same code can only succeed once.
    const [updated] = await this.db
      .update(totpSecrets)
      .set({ recoveryCodesHash: sql`array_remove(${totpSecrets.recoveryCodesHash}, ${match})` })
      .where(
        sql`${totpSecrets.userId} = ${userId} AND ${match} = ANY(${totpSecrets.recoveryCodesHash})`,
      )
      .returning({ userId: totpSecrets.userId });
    return Boolean(updated);
  }

  private async checkTotp(
    userId: string,
    row: typeof totpSecrets.$inferSelect,
    code: string,
  ): Promise<boolean> {
    const key = this.keyring.totp.find((candidate) => candidate.version === row.keyVersion);
    if (!key) throw new Error(`TOTP key version ${row.keyVersion} is not configured`);
    const secret = new Secret({
      buffer: new Uint8Array(decrypt(key.key, row.secretEncrypted)).buffer,
    });
    const now = Date.now();
    const delta = this.totp(secret, '').validate({ token: code, timestamp: now, window: 1 });
    if (delta === null) return false;
    const step = TOTP.counter({ period: PERIOD_SEC, timestamp: now }) + delta;
    // Replay protection: a code seen once is refused for the rest of its validity.
    const fresh = await this.redis.set(
      `auth:totp-used:${userId}:${step}`,
      '1',
      'EX',
      PERIOD_SEC * 4,
      'NX',
    );
    return fresh === 'OK';
  }

  private totp(secret: Secret, label: string): TOTP {
    return new TOTP({
      issuer: ISSUER,
      label,
      secret,
      algorithm: 'SHA1',
      digits: 6,
      period: PERIOD_SEC,
    });
  }
}
