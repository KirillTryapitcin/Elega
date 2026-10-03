import {
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  SIGNED_URL_TTL_SECONDS,
  SIGNED_URL_WINDOW_SECONDS,
  UPLOAD_SLOT_TTL_SECONDS,
} from '@elega/shared';
import type { Env } from '../config/env.js';

export const STORAGE = Symbol('STORAGE');

export type StorageConfig = Pick<
  Env,
  | 'S3_ENDPOINT'
  | 'S3_PUBLIC_ENDPOINT'
  | 'S3_REGION'
  | 'S3_ACCESS_KEY'
  | 'S3_SECRET_KEY'
  | 'S3_BUCKET_PRIVATE'
  | 'S3_FORCE_PATH_STYLE'
>;

/** Readiness probe budget (readyz answers within it even when storage hangs). */
export const STORAGE_PING_TIMEOUT_MS = 2_000;
const CONNECT_TIMEOUT_MS = 2_000;
const REQUEST_TIMEOUT_MS = 10_000;
const MS_PER_SECOND = 1_000;
const HTTP_NOT_FOUND = 404;
/** S3 limit on key length, in bytes. */
const MAX_KEY_BYTES = 1_024;
const KEY_SEGMENT = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/;

/** Headers the browser must send with the PUT exactly as signed (SeaweedFS answers 403 otherwise). */
export interface PresignedPut {
  url: string;
  headers: { 'content-type': string };
  expiresAt: Date;
}

export interface ObjectHead {
  contentLength: number;
  contentType: string | null;
}

export interface PutOptions {
  contentType: string;
  cacheControl?: string;
  contentDisposition?: string;
}

/**
 * Keys are built by `storageKeys()` in @elega/shared (`u/<root>`, `m/<root>/...`). This is the
 * last line of defence against a key that escapes its prefix or carries odd characters.
 */
export function assertStorageKey(key: string): void {
  const segments = key.split('/');
  const valid =
    Buffer.byteLength(key) <= MAX_KEY_BYTES &&
    segments.every((segment) => KEY_SEGMENT.test(segment) && segment !== '.' && segment !== '..');
  if (!valid) throw new Error('Invalid storage key');
}

/**
 * Start of the signing window that `at` falls in. Signed GET URLs use it as their signing date,
 * so every URL for an object is identical for a whole window (browsers cache the image) and
 * stays valid for at least `SIGNED_URL_TTL_SECONDS` after it was handed out.
 */
export function signingWindowStart(at: Date): Date {
  const windowMs = SIGNED_URL_WINDOW_SECONDS * MS_PER_SECOND;
  return new Date(Math.floor(at.getTime() / windowMs) * windowMs);
}

/**
 * The private media bucket (ADR-006, DESIGN §3). Two clients with the same identity:
 * `internal` talks to `S3_ENDPOINT` (HEAD, PUT, health check); `presigner` only signs URLs for
 * `S3_PUBLIC_ENDPOINT`, the host browsers use, because the host is part of the signature.
 * Construction makes no network call, so tests without storage can build the app.
 *
 * Checksums are calculated only when an operation requires them: by default the SDK adds a
 * CRC32 of the (empty) presigned body to the URL, and SeaweedFS then rejects every upload.
 */
export class Storage {
  private readonly internal: S3Client;
  private readonly presigner: S3Client;
  private readonly bucket: string;

  constructor(config: StorageConfig) {
    const common = {
      region: config.S3_REGION,
      forcePathStyle: config.S3_FORCE_PATH_STYLE,
      credentials: { accessKeyId: config.S3_ACCESS_KEY, secretAccessKey: config.S3_SECRET_KEY },
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    } as const;
    this.internal = new S3Client({
      ...common,
      endpoint: config.S3_ENDPOINT,
      requestHandler: {
        connectionTimeout: CONNECT_TIMEOUT_MS,
        requestTimeout: REQUEST_TIMEOUT_MS,
        throwOnRequestTimeout: true,
      },
    });
    this.presigner = new S3Client({ ...common, endpoint: config.S3_PUBLIC_ENDPOINT });
    this.bucket = config.S3_BUCKET_PRIVATE;
  }

  /**
   * A browser upload URL valid for `UPLOAD_SLOT_TTL_SECONDS`. Content type and length are
   * signed (the presigner leaves content-type unsigned by default, which would let any type
   * through), so the upload must match what the API accepted.
   */
  async presignPut(
    key: string,
    object: { contentType: string; contentLength: number },
    now: Date = new Date(),
  ): Promise<PresignedPut> {
    assertStorageKey(key);
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: object.contentType,
      ContentLength: object.contentLength,
    });
    const url = await getSignedUrl(this.presigner, command, {
      expiresIn: UPLOAD_SLOT_TTL_SECONDS,
      signingDate: now,
      signableHeaders: new Set(['content-type', 'content-length']),
    });
    return {
      url,
      headers: { 'content-type': object.contentType },
      expiresAt: new Date(now.getTime() + UPLOAD_SLOT_TTL_SECONDS * MS_PER_SECOND),
    };
  }

  /**
   * A read URL, stable within a signing window and valid for at least `SIGNED_URL_TTL_SECONDS`
   * (at most TTL + window) after `now`. Never log it: it is a bearer credential for the object.
   */
  presignGet(key: string, now: Date = new Date()): Promise<string> {
    assertStorageKey(key);
    return getSignedUrl(this.presigner, new GetObjectCommand({ Bucket: this.bucket, Key: key }), {
      expiresIn: SIGNED_URL_TTL_SECONDS + SIGNED_URL_WINDOW_SECONDS,
      signingDate: signingWindowStart(now),
    });
  }

  /** Size and type of an object, or null when it does not exist. */
  async head(key: string): Promise<ObjectHead | null> {
    assertStorageKey(key);
    try {
      const head = await this.internal.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return { contentLength: head.ContentLength ?? 0, contentType: head.ContentType ?? null };
    } catch (error) {
      if (
        error instanceof S3ServiceException &&
        error.$metadata.httpStatusCode === HTTP_NOT_FOUND
      ) {
        return null;
      }
      throw error;
    }
  }

  /** Server-side upload (the seed pushes its fixtures through the normal pipeline with it). */
  async putObject(key: string, body: Uint8Array, options: PutOptions): Promise<void> {
    assertStorageKey(key);
    await this.internal.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentLength: body.byteLength,
        ContentType: options.contentType,
        CacheControl: options.cacheControl,
        ContentDisposition: options.contentDisposition,
      }),
    );
  }

  /** Readiness: the bucket answers HEAD with our credentials within the probe budget. */
  async ping(): Promise<void> {
    await this.internal.send(new HeadBucketCommand({ Bucket: this.bucket }), {
      abortSignal: AbortSignal.timeout(STORAGE_PING_TIMEOUT_MS),
    });
  }

  /** Closes pooled sockets on shutdown. */
  destroy(): void {
    this.internal.destroy();
    this.presigner.destroy();
  }
}

export function createStorage(config: StorageConfig): Storage {
  return new Storage(config);
}
