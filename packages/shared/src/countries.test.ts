import { describe, expect, it } from 'vitest';
import { COUNTRY_CODES, isCountryCode } from './countries.js';

describe('COUNTRY_CODES', () => {
  it('lists the 249 assigned ISO 3166-1 alpha-2 codes, sorted and unique', () => {
    expect(COUNTRY_CODES).toHaveLength(249);
    expect(new Set(COUNTRY_CODES).size).toBe(COUNTRY_CODES.length);
    expect([...COUNTRY_CODES].sort()).toEqual([...COUNTRY_CODES]);
    for (const code of COUNTRY_CODES) expect(code).toMatch(/^[A-Z]{2}$/);
  });

  it('includes the core markets and excludes retired or reserved codes', () => {
    for (const code of ['RU', 'BY', 'KZ', 'UZ', 'KG', 'AM', 'AZ', 'GE', 'MD', 'TJ', 'UA']) {
      expect(isCountryCode(code)).toBe(true);
    }
    for (const code of ['SU', 'UK', 'YU', 'EU', 'XK', 'ZZ', 'ru', 'RUS', '']) {
      expect(isCountryCode(code)).toBe(false);
    }
  });
});
