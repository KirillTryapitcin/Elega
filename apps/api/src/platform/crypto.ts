import { createHash, createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Env } from '../config/env.js';

export const KEYRING = Symbol('KEYRING');

/** Purpose-specific keys derived from APP_SECRET, so one leaked key does not expose the others. */
export interface Keyring {
  /** HMAC key for IP addresses and login identifiers (stored hashed, brief §20.2). */
  readonly pii: Buffer;
  /** HMAC key for opaque pagination cursors. */
  readonly cursor: Buffer;
  /** HMAC key for short-lived browser-binding cookies (OAuth state). */
  readonly state: Buffer;
  /** EdDSA seeds by key id, newest first. */
  readonly jwt: ReadonlyArray<{ id: string; seed: Buffer }>;
  /** AES-256-GCM keys for TOTP secrets by version, newest first. */
  readonly totp: ReadonlyArray<{ version: number; key: Buffer }>;
}

export function deriveKey(secret: string, purpose: string, length = 32): Buffer {
  return Buffer.from(hkdfSync('sha256', secret, 'elega', `elega:${purpose}`, length));
}

export function createKeyring(
  env: Pick<Env, 'APP_SECRET' | 'AUTH_JWT_KEYS' | 'AUTH_TOTP_KEYS'>,
): Keyring {
  const jwt = env.AUTH_JWT_KEYS?.map((key) => ({
    id: key.id,
    seed: deriveKey(key.secret, 'jwt'),
  })) ?? [{ id: 'app-1', seed: deriveKey(env.APP_SECRET, 'jwt') }];
  const totp = env.AUTH_TOTP_KEYS?.map((key) => {
    const version = Number(key.id);
    if (!Number.isInteger(version) || version < 1 || version > 32_767) {
      throw new Error('AUTH_TOTP_KEYS ids must be integers between 1 and 32767');
    }
    return { version, key: deriveKey(key.secret, 'totp') };
  }) ?? [{ version: 1, key: deriveKey(env.APP_SECRET, 'totp') }];
  return {
    pii: deriveKey(env.APP_SECRET, 'pii'),
    cursor: deriveKey(env.APP_SECRET, 'cursor'),
    state: deriveKey(env.APP_SECRET, 'state'),
    jwt,
    totp,
  };
}

/** URL-safe random token with `bytes` bytes of entropy (default 256 bits). */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256(value: string | Buffer): Buffer {
  return createHash('sha256').update(value).digest();
}

export function hmac(key: Buffer, value: string): Buffer {
  return createHmac('sha256', key).update(value).digest();
}

/** Constant-time comparison that also tolerates different lengths. */
export function safeEqual(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}
