/**
 * Media limits and storage layout (brief §18, DESIGN M2 §1.2). The API, the worker and the web
 * all read these; no upload limit or variant size is hard-coded anywhere else. Zod-free so
 * client components can import it through `@elega/shared/media`.
 */

export const MEDIA_KINDS = ['image', 'video', 'audio', 'file'] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];

export const MEDIA_PURPOSES = [
  'post',
  'comment',
  'avatar',
  'cover',
  'story',
  'message',
  'group',
  'page',
] as const;
export type MediaPurpose = (typeof MEDIA_PURPOSES)[number];

/** Purposes the M2 pipeline accepts; the rest arrive with their milestones. */
export const M2_PURPOSES = ['avatar', 'cover'] as const;
export type ProfileMediaPurpose = (typeof M2_PURPOSES)[number];

export function isProfileMediaPurpose(purpose: string): purpose is ProfileMediaPurpose {
  return (M2_PURPOSES as readonly string[]).includes(purpose);
}

/** M2 accepts JPEG only: the web client re-encodes every pick, which keeps the decoder surface small. */
export const ACCEPTED_IMAGE_TYPES = ['image/jpeg'] as const;
export type AcceptedImageType = (typeof ACCEPTED_IMAGE_TYPES)[number];

export function isAcceptedImageType(mime: string): mime is AcceptedImageType {
  return (ACCEPTED_IMAGE_TYPES as readonly string[]).includes(mime);
}

const MIB = 1024 * 1024;

/** Global caps from brief §18.2; per-purpose limits below are stricter. */
export const IMAGE_MAX_BYTES = 20 * MIB;
export const IMAGE_MAX_DIMENSION = 8000;

/** Per-purpose limits. `aspect` is width / height. */
export const PURPOSE_LIMITS = {
  avatar: { maxBytes: 5 * MIB, maxDimension: 2048, aspect: 1 },
  cover: { maxBytes: 8 * MIB, maxDimension: 4096, aspect: 3 },
} as const satisfies Record<
  ProfileMediaPurpose,
  { maxBytes: number; maxDimension: number; aspect: number }
>;

/** Allowed relative deviation from the purpose's aspect ratio (±2 %). */
export const ASPECT_TOLERANCE = 0.02;
const FLOAT_EPSILON = 1e-9;

/** What the client cropper renders before upload. */
export const CLIENT_CROP_OUTPUT = {
  avatar: { width: 1080, height: 1080 },
  cover: { width: 2160, height: 720 },
} as const satisfies Record<ProfileMediaPurpose, { width: number; height: number }>;
export const CLIENT_JPEG_QUALITY = 0.85;
/** Largest file the picker accepts before decoding it. */
export const CLIENT_SOURCE_MAX_BYTES = 50 * MIB;
/** The client decodes large photos scaled down to about this many pixels. */
export const CLIENT_DECODE_MAX_PIXELS = 16_000_000;

export const IMAGE_FORMATS = ['avif', 'webp', 'jpeg'] as const;
export type ImageFormat = (typeof IMAGE_FORMATS)[number];

/** Responsive widths per purpose (brief §18.2 ladder, trimmed to what each purpose renders). */
export const IMAGE_VARIANT_WIDTHS = {
  avatar: [160, 320, 720],
  cover: [320, 720, 1440],
} as const satisfies Record<ProfileMediaPurpose, readonly number[]>;

export const IMAGE_ENCODE = {
  avif: { quality: 50, effort: 3 },
  webp: { quality: 75 },
  jpeg: { quality: 80, mozjpeg: true },
} as const;
/** Quality of the stripped full-size archive kept next to the variants. */
export const ORIGINAL_JPEG_QUALITY = 90;

/** Lifetime of a presigned PUT (ADR-006). */
export const UPLOAD_SLOT_TTL_SECONDS = 600;
/** After the slot expires, the raw upload is swept this much later whatever its state. */
export const SWEEP_GRACE_SECONDS = 60;
/** Uploads a user may have waiting (pending or processing) at once. */
export const MAX_PENDING_UPLOADS = 10;
/** Storage per user; trust-level scaling comes later. */
export const MEDIA_QUOTA_BYTES = 2 * 1024 * MIB;
/** Brief §9.4: avatar history keeps the last 10. */
export const AVATAR_HISTORY_LIMIT = 10;
/** Brief §18.6: uploaded but never attached media is removed after 24 h. */
export const ORPHAN_TTL_HOURS = 24;
export const REJECTED_TTL_HOURS = 24;
/** A row still `processing` after this long is re-queued, then failed. */
export const STUCK_PROCESSING_MINUTES = 10;
export const STUCK_PROCESSING_MAX_RETRIES = 3;

/** Signed GET URLs for private variants. */
export const SIGNED_URL_TTL_SECONDS = 3600;
/** Signing dates are rounded down to this window so a URL stays stable for browser caching. */
export const SIGNED_URL_WINDOW_SECONDS = 1800;

export const MEDIA_REJECTION_REASONS = [
  'too_large',
  'unsupported_type',
  'dimensions',
  'aspect_ratio',
  'corrupt',
  'malware',
  'policy',
  'expired',
  'failed',
] as const;
export type MediaRejectionReason = (typeof MEDIA_REJECTION_REASONS)[number];

export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;
export const IDEMPOTENCY_TTL_HOURS = 24;

/** A storage root: 128 random bits, hex-encoded (never derived from user or media ids). */
export const STORAGE_ROOT_PATTERN = /^[0-9a-f]{32}$/;

const FORMAT_EXTENSION = { avif: 'avif', webp: 'webp', jpeg: 'jpg' } as const satisfies Record<
  ImageFormat,
  string
>;

export interface StorageKeys {
  /** Where the browser PUTs the upload. Deleted after processing and swept after slot expiry. */
  readonly raw: string;
  /** Everything derived from the upload lives under this prefix. */
  readonly prefix: string;
  /** Stripped full-size archive. */
  readonly original: string;
  variant(width: number, format: ImageFormat): string;
}

/** Every object key for one media row, derived from its storage root. */
export function storageKeys(root: string): StorageKeys {
  if (!STORAGE_ROOT_PATTERN.test(root)) throw new Error('Invalid storage root');
  const prefix = `m/${root}/`;
  return {
    raw: `u/${root}`,
    prefix,
    original: `${prefix}original.jpg`,
    variant(width, format) {
      if (!Number.isInteger(width) || width <= 0) throw new Error('Invalid variant width');
      return `${prefix}${width}.${FORMAT_EXTENSION[format]}`;
    },
  };
}

/** The purpose's width ladder capped at the source width; never empty. */
export function variantWidthsFor(purpose: ProfileMediaPurpose, sourceWidth: number): number[] {
  const widths = IMAGE_VARIANT_WIDTHS[purpose].filter((width) => width <= sourceWidth);
  return widths.length > 0 ? widths : [sourceWidth];
}

/** Whether width / height is within ±ASPECT_TOLERANCE of the purpose's aspect ratio. */
export function aspectWithinTolerance(
  purpose: ProfileMediaPurpose,
  width: number,
  height: number,
): boolean {
  if (width <= 0 || height <= 0) return false;
  const expected = PURPOSE_LIMITS[purpose].aspect;
  // The epsilon keeps exact boundaries (e.g. 1020×1000) inside despite floating-point error.
  return Math.abs(width / height / expected - 1) <= ASPECT_TOLERANCE + FLOAT_EPSILON;
}
