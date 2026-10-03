import { randomBytes } from 'node:crypto';
import {
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { STORAGE, Storage, type StorageConfig } from '../src/platform/storage.js';
import {
  buildApp,
  type Infra,
  S3_BUCKETS,
  S3_CORS_ORIGIN,
  S3_IDENTITIES,
  type StartedStorage,
  startInfra,
} from './harness.js';

/**
 * The storage adapter against a real SeaweedFS with the repo's s3.json (DESIGN §3.2): signed
 * uploads enforce type and size, private objects need a signature, nothing is listable or
 * readable anonymously, and the API identity has no more rights than it needs.
 */
const JPEG = 'image/jpeg';
const REGION = 'us-east-1';
const HTTP = { ok: 200, forbidden: 403 } as const;
/** What the browser sends with the PUT: the signed content type (length comes from the body). */
const SIGNED_HEADERS = { 'content-type': JPEG };

let infra: Infra;
let app: NestFastifyApplication;
let s3: StartedStorage;
let storage: Storage;

/** Storage roots are 128-bit random values, hex-encoded (DESIGN §2). */
const ROOT_BYTES = 16;
const rawKey = () => `u/${randomBytes(ROOT_BYTES).toString('hex')}`;
const body = (size: number) => randomBytes(size);

function config(overrides: Partial<StorageConfig> = {}): StorageConfig {
  return {
    S3_ENDPOINT: s3.endpoint,
    S3_PUBLIC_ENDPOINT: s3.endpoint,
    S3_REGION: REGION,
    S3_ACCESS_KEY: S3_IDENTITIES.api.accessKey,
    S3_SECRET_KEY: S3_IDENTITIES.api.secretKey,
    S3_BUCKET_PRIVATE: S3_BUCKETS.private,
    S3_FORCE_PATH_STYLE: true,
    ...overrides,
  };
}

/** A raw client with the API identity, for operations the adapter deliberately does not offer. */
function apiClient(): S3Client {
  return new S3Client({
    endpoint: s3.endpoint,
    region: REGION,
    forcePathStyle: true,
    credentials: {
      accessKeyId: S3_IDENTITIES.api.accessKey,
      secretAccessKey: S3_IDENTITIES.api.secretKey,
    },
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
}

async function statusOf(run: () => Promise<unknown>): Promise<number | undefined> {
  try {
    await run();
    return HTTP.ok;
  } catch (error) {
    return error instanceof S3ServiceException ? error.$metadata.httpStatusCode : undefined;
  }
}

async function upload(size: number, headers: Record<string, string>, payload = body(size)) {
  const key = rawKey();
  const slot = await storage.presignPut(key, { contentType: JPEG, contentLength: size });
  const res = await fetch(slot.url, { method: 'PUT', body: payload, headers });
  return { key, slot, status: res.status };
}

beforeAll(async () => {
  infra = await startInfra({ storage: true });
  if (!infra.storage) throw new Error('startInfra({ storage: true }) started no storage');
  s3 = infra.storage;
  storage = new Storage(config());
  app = await buildApp();
});

afterAll(async () => {
  storage?.destroy();
  await app?.close();
  await infra?.stop();
});

describe('storage', () => {
  it('is wired into the app from the environment the harness sets', async () => {
    await expect(app.get<Storage>(STORAGE).ping()).resolves.toBeUndefined();
    const res = await app.inject({ method: 'GET', url: '/api/v1/readyz' });
    expect(res.json()).toEqual({
      status: 'ok',
      checks: { database: 'ok', redis: 'ok', storage: 'ok' },
    });
  });

  it('answers the readiness ping, and fails it fast when unreachable', async () => {
    await expect(storage.ping()).resolves.toBeUndefined();
    const offline = new Storage(config({ S3_ENDPOINT: 'http://127.0.0.1:1' }));
    try {
      await expect(offline.ping()).rejects.toThrow();
    } finally {
      offline.destroy();
    }
  });

  it('accepts a presigned PUT with exactly the signed type and size', async () => {
    const size = 1234;
    const { key, slot, status } = await upload(size, SIGNED_HEADERS);
    expect(status).toBe(HTTP.ok);
    expect(slot.headers).toEqual({ 'content-type': JPEG });
    expect(await storage.head(key)).toEqual({ contentLength: size, contentType: JPEG });
    expect(await storage.head(rawKey())).toBeNull();
  });

  it('refuses a presigned PUT with another type, no type, or another size', async () => {
    const size = 64;
    expect((await upload(size, { 'content-type': 'text/html' })).status).toBe(HTTP.forbidden);
    expect((await upload(size, {})).status).toBe(HTTP.forbidden);
    expect((await upload(size, SIGNED_HEADERS, body(size - 1))).status).toBe(HTTP.forbidden);
    expect((await upload(size, SIGNED_HEADERS, body(size + 1))).status).toBe(HTTP.forbidden);
  });

  it('ignores an unsigned ACL header: the object stays private', async () => {
    const { key, status } = await upload(32, { ...SIGNED_HEADERS, 'x-amz-acl': 'public-read' });
    if (status === HTTP.ok) {
      const anonymous = await fetch(`${s3.endpoint}/${S3_BUCKETS.private}/${key}`);
      expect(anonymous.status).toBe(HTTP.forbidden);
    } else {
      expect(status).toBe(HTTP.forbidden);
    }
  });

  it('serves private objects only through signed URLs, stable within a window', async () => {
    const key = rawKey();
    const payload = body(100);
    await storage.putObject(key, payload, {
      contentType: 'image/webp',
      cacheControl: 'private, max-age=3600',
      contentDisposition: 'inline',
    });
    const now = new Date();
    const url = await storage.presignGet(key, now);
    expect(await storage.presignGet(key, new Date(now.getTime() + 1))).toBe(url);
    const signed = await fetch(url);
    expect(signed.status).toBe(HTTP.ok);
    expect(signed.headers.get('content-type')).toBe('image/webp');
    expect(signed.headers.get('cache-control')).toBe('private, max-age=3600');
    expect(signed.headers.get('content-disposition')).toBe('inline');
    expect(Buffer.from(await signed.arrayBuffer())).toEqual(payload);

    expect((await fetch(`${s3.endpoint}/${S3_BUCKETS.private}/${key}`)).status).toBe(
      HTTP.forbidden,
    );
    const tampered = url.replace(/X-Amz-Signature=[0-9a-f]+/, `X-Amz-Signature=${'0'.repeat(64)}`);
    expect((await fetch(tampered)).status).toBe(HTTP.forbidden);
  });

  it('lists nothing and writes nothing anonymously', async () => {
    for (const bucket of Object.values(S3_BUCKETS)) {
      expect((await fetch(`${s3.endpoint}/${bucket}?list-type=2`)).status).toBe(HTTP.forbidden);
      const put = await fetch(`${s3.endpoint}/${bucket}/anonymous.txt`, {
        method: 'PUT',
        body: 'x',
      });
      expect(put.status).toBe(HTTP.forbidden);
    }
    expect((await fetch(`${s3.endpoint}/`)).status).toBe(HTTP.forbidden);
  });

  it('gives the API identity no listing and no access to the public bucket', async () => {
    const client = apiClient();
    try {
      expect(
        await statusOf(() => client.send(new ListObjectsV2Command({ Bucket: S3_BUCKETS.private }))),
      ).toBe(HTTP.forbidden);
      expect(
        await statusOf(() =>
          client.send(new PutObjectCommand({ Bucket: S3_BUCKETS.public, Key: 'x', Body: 'x' })),
        ),
      ).toBe(HTTP.forbidden);
    } finally {
      client.destroy();
    }
  });

  it('answers CORS preflights only for the app origin', async () => {
    const preflight = (origin: string) =>
      fetch(`${s3.endpoint}/${S3_BUCKETS.private}/${rawKey()}`, {
        method: 'OPTIONS',
        headers: {
          origin,
          'access-control-request-method': 'PUT',
          'access-control-request-headers': 'content-type',
        },
      });
    const allowed = await preflight(S3_CORS_ORIGIN);
    expect(allowed.status).toBe(HTTP.ok);
    expect(allowed.headers.get('access-control-allow-origin')).toBe(S3_CORS_ORIGIN);
    const evil = await preflight('https://evil.example');
    expect(evil.headers.get('access-control-allow-origin')).toBeNull();
    expect(evil.status).toBe(HTTP.forbidden);
  });
});
