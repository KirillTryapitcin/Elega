import { describe, expect, it } from 'vitest';
import {
  ACCEPTED_IMAGE_TYPES,
  aspectWithinTolerance,
  CLIENT_CROP_OUTPUT,
  IMAGE_MAX_BYTES,
  IMAGE_MAX_DIMENSION,
  IMAGE_VARIANT_WIDTHS,
  isAcceptedImageType,
  isProfileMediaPurpose,
  M2_PURPOSES,
  MEDIA_PURPOSES,
  PURPOSE_LIMITS,
  storageKeys,
  variantWidthsFor,
} from './media.js';

const ROOT = '0123456789abcdef0123456789abcdef';

describe('storageKeys', () => {
  it('derives every key from the root', () => {
    const keys = storageKeys(ROOT);
    expect(keys.raw).toBe(`u/${ROOT}`);
    expect(keys.prefix).toBe(`m/${ROOT}/`);
    expect(keys.original).toBe(`m/${ROOT}/original.jpg`);
    expect(keys.variant(320, 'avif')).toBe(`m/${ROOT}/320.avif`);
    expect(keys.variant(320, 'webp')).toBe(`m/${ROOT}/320.webp`);
    expect(keys.variant(320, 'jpeg')).toBe(`m/${ROOT}/320.jpg`);
  });

  it.each([
    '',
    'ABCDEF0123456789abcdef0123456789',
    `${ROOT}0`,
    '../etc/passwd',
    `${ROOT.slice(1)}/`,
  ])('rejects root %j', (root) => {
    expect(() => storageKeys(root)).toThrow('Invalid storage root');
  });

  it.each([0, -1, 1.5, Number.NaN])('rejects variant width %d', (width) => {
    expect(() => storageKeys(ROOT).variant(width, 'jpeg')).toThrow('Invalid variant width');
  });
});

describe('variantWidthsFor', () => {
  it('caps the ladder at the source width', () => {
    expect(variantWidthsFor('avatar', 1080)).toEqual([160, 320, 720]);
    expect(variantWidthsFor('avatar', 320)).toEqual([160, 320]);
    expect(variantWidthsFor('cover', 2160)).toEqual([320, 720, 1440]);
    expect(variantWidthsFor('cover', 1000)).toEqual([320, 720]);
  });

  it('never returns an empty ladder', () => {
    expect(variantWidthsFor('avatar', 100)).toEqual([100]);
    expect(variantWidthsFor('cover', 300)).toEqual([300]);
  });
});

describe('aspectWithinTolerance', () => {
  const cases: [Parameters<typeof aspectWithinTolerance>, boolean][] = [
    [['avatar', 1080, 1080], true],
    [['avatar', 1020, 1000], true],
    [['avatar', 1021, 1000], false],
    [['avatar', 980, 1000], true],
    [['avatar', 979, 1000], false],
    [['cover', 2160, 720], true],
    [['cover', 2200, 720], true],
    [['cover', 1080, 1080], false],
    [['avatar', 0, 100], false],
    [['avatar', 100, 0], false],
  ];
  it.each(cases)('%j → %s', (args, expected) => {
    expect(aspectWithinTolerance(...args)).toBe(expected);
  });
});

describe('type guards', () => {
  it('accepts JPEG only in M2', () => {
    expect(ACCEPTED_IMAGE_TYPES).toEqual(['image/jpeg']);
    expect(isAcceptedImageType('image/jpeg')).toBe(true);
    for (const type of [
      'image/png',
      'image/webp',
      'image/avif',
      'image/heic',
      'image/svg+xml',
      'text/html',
    ]) {
      expect(isAcceptedImageType(type)).toBe(false);
    }
  });

  it('accepts avatar and cover purposes only in M2', () => {
    for (const purpose of MEDIA_PURPOSES) {
      expect(isProfileMediaPurpose(purpose)).toBe(
        (M2_PURPOSES as readonly string[]).includes(purpose),
      );
    }
  });
});

describe('limits are consistent', () => {
  it('keeps every purpose inside the global caps', () => {
    for (const purpose of M2_PURPOSES) {
      const limits = PURPOSE_LIMITS[purpose];
      expect(limits.maxBytes).toBeLessThanOrEqual(IMAGE_MAX_BYTES);
      expect(limits.maxDimension).toBeLessThanOrEqual(IMAGE_MAX_DIMENSION);
      for (const width of IMAGE_VARIANT_WIDTHS[purpose]) {
        expect(width).toBeLessThanOrEqual(limits.maxDimension);
      }
    }
  });

  it('crops on the client to the purpose aspect, inside the server limits', () => {
    for (const purpose of M2_PURPOSES) {
      const { width, height } = CLIENT_CROP_OUTPUT[purpose];
      expect(aspectWithinTolerance(purpose, width, height)).toBe(true);
      expect(Math.max(width, height)).toBeLessThanOrEqual(PURPOSE_LIMITS[purpose].maxDimension);
    }
  });
});
