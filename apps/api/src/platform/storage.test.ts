import {
  SIGNED_URL_TTL_SECONDS,
  SIGNED_URL_WINDOW_SECONDS,
  UPLOAD_SLOT_TTL_SECONDS,
} from '@elega/shared';
import { afterAll, describe, expect, it } from 'vitest';
import { assertStorageKey, signingWindowStart, Storage } from './storage.js';

const SECOND = 1_000;
const ROOT = '0123456789abcdef0123456789abcdef';
// Nothing listens here: these tests must never reach the network.
const storage = new Storage({
  S3_ENDPOINT: 'http://127.0.0.1:1',
  S3_PUBLIC_ENDPOINT: 'https://media.elega.test',
  S3_REGION: 'us-east-1',
  S3_ACCESS_KEY: 'unit_test_local_only_key',
  S3_SECRET_KEY: 'unit_test_local_only_secret',
  S3_BUCKET_PRIVATE: 'elega-private',
  S3_FORCE_PATH_STYLE: true,
});

afterAll(() => storage.destroy());

/** `20261003T101500Z` → Date. */
function amzDate(value: string | null): Date {
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(value ?? '');
  if (!match) throw new Error(`not an X-Amz-Date: ${value}`);
  const [, y, mo, d, h, mi, s] = match.map(Number);
  return new Date(Date.UTC(y!, mo! - 1, d, h, mi, s));
}

describe('storage keys', () => {
  it('accepts the key layout and rejects anything that could escape it', () => {
    for (const key of [`u/${ROOT}`, `m/${ROOT}/original.jpg`, `m/${ROOT}/320.avif`]) {
      expect(() => assertStorageKey(key)).not.toThrow();
    }
    for (const key of [
      '',
      `/u/${ROOT}`,
      `u/${ROOT}/`,
      `m//${ROOT}`,
      `m/${ROOT}/../other`,
      'm/./x',
      'u/a b',
      'u/a?b',
      'u/фото',
      `u/${'a'.repeat(1_100)}`,
    ]) {
      expect(() => assertStorageKey(key), key).toThrow(/Invalid storage key/);
    }
  });
});

describe('presigned upload', () => {
  it('signs content type, length and host for the public endpoint, without checksums', async () => {
    const now = new Date('2026-10-03T10:17:42Z');
    const slot = await storage.presignPut(
      `u/${ROOT}`,
      { contentType: 'image/jpeg', contentLength: 4_321 },
      now,
    );
    const url = new URL(slot.url);
    expect(url.origin).toBe('https://media.elega.test');
    expect(url.pathname).toBe(`/elega-private/u/${ROOT}`);
    expect(url.searchParams.get('X-Amz-SignedHeaders')).toBe('content-length;content-type;host');
    expect(url.searchParams.get('X-Amz-Expires')).toBe(String(UPLOAD_SLOT_TTL_SECONDS));
    expect(amzDate(url.searchParams.get('X-Amz-Date'))).toEqual(now);
    // A CRC of the empty presign body would make SeaweedFS reject every real upload.
    expect([...url.searchParams.keys()].filter((key) => /checksum/i.test(key))).toEqual([]);
    expect(slot.headers).toEqual({ 'content-type': 'image/jpeg' });
    expect(slot.expiresAt).toEqual(new Date(now.getTime() + UPLOAD_SLOT_TTL_SECONDS * SECOND));
  });

  it('refuses an invalid key before signing anything', async () => {
    await expect(
      storage.presignPut('../x', { contentType: 'image/jpeg', contentLength: 1 }),
    ).rejects.toThrow(/Invalid storage key/);
  });
});

describe('signed read URLs', () => {
  const windowMs = SIGNED_URL_WINDOW_SECONDS * SECOND;
  const start = new Date(Math.ceil(Date.parse('2026-10-03T10:00:00Z') / windowMs) * windowMs);

  it('round the signing date down to the window', () => {
    expect(signingWindowStart(start)).toEqual(start);
    expect(signingWindowStart(new Date(start.getTime() + windowMs - 1))).toEqual(start);
    expect(signingWindowStart(new Date(start.getTime() + windowMs))).toEqual(
      new Date(start.getTime() + windowMs),
    );
  });

  it('are identical within a window and valid for at least the TTL after issue', async () => {
    const key = `m/${ROOT}/320.webp`;
    const early = await storage.presignGet(key, start);
    const late = await storage.presignGet(key, new Date(start.getTime() + windowMs - 1));
    const next = await storage.presignGet(key, new Date(start.getTime() + windowMs));
    expect(late).toBe(early);
    expect(next).not.toBe(early);

    const url = new URL(late);
    expect(url.origin).toBe('https://media.elega.test');
    expect(url.pathname).toBe(`/elega-private/${key}`);
    const signedAt = amzDate(url.searchParams.get('X-Amz-Date'));
    const expiresIn = Number(url.searchParams.get('X-Amz-Expires'));
    expect(signedAt).toEqual(start);
    expect(expiresIn).toBe(SIGNED_URL_TTL_SECONDS + SIGNED_URL_WINDOW_SECONDS);
    // Issued at the very end of the window, it still lives for the whole TTL.
    const issuedAt = start.getTime() + windowMs - 1;
    expect(signedAt.getTime() + expiresIn * SECOND - issuedAt).toBeGreaterThanOrEqual(
      SIGNED_URL_TTL_SECONDS * SECOND,
    );
  });
});
