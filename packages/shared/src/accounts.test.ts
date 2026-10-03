import { describe, expect, it } from 'vitest';
import {
  ageOn,
  birthdateSchema,
  isMinor,
  minorSettingViolations,
  MINOR_DEFAULT_SETTINGS,
  usernameProblem,
} from './accounts.js';

describe('usernameProblem', () => {
  it('accepts valid names', () => {
    expect(usernameProblem('anya.k')).toBeNull();
    expect(usernameProblem('dmitry_31')).toBeNull();
  });

  it('rejects bad format, double dots and reserved words', () => {
    expect(usernameProblem('Ab')).toBe('format');
    expect(usernameProblem('anya..k')).toBe('consecutive_dots');
    expect(usernameProblem('ad.min')).toBe('reserved');
    expect(usernameProblem('support_')).toBe('reserved');
  });
});

describe('age gate', () => {
  const today = new Date(Date.UTC(2026, 9, 2));

  it('counts full years and respects the birthday', () => {
    expect(ageOn('2012-10-02', today)).toBe(14);
    expect(ageOn('2012-10-03', today)).toBe(13);
    expect(ageOn('2008-10-02', today)).toBe(18);
  });

  it('rejects impossible dates', () => {
    expect(ageOn('2010-02-30', today)).toBeNull();
    expect(ageOn('10.02.2010', today)).toBeNull();
  });

  it('marks under-18 as minor', () => {
    expect(isMinor('2008-10-03', today)).toBe(true);
    expect(isMinor('2008-10-02', today)).toBe(false);
  });

  it('schema refuses under 14', () => {
    const tooYoung = new Date();
    tooYoung.setUTCFullYear(tooYoung.getUTCFullYear() - 13);
    const result = birthdateSchema.safeParse(tooYoung.toISOString().slice(0, 10));
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe('birthdate_too_young');
  });
});

describe('minor settings', () => {
  it('defaults pass the limits', () => {
    expect(minorSettingViolations(MINOR_DEFAULT_SETTINGS)).toEqual([]);
  });

  it('flags loosened settings', () => {
    expect(
      minorSettingViolations({
        whoCanMessage: 'everyone',
        searchEngineIndexing: true,
        theme: 'dark',
      }),
    ).toEqual(['whoCanMessage', 'searchEngineIndexing']);
  });
});
