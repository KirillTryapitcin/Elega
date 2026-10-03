import { describe, expect, it } from 'vitest';
import { displayHost } from './link-policy.js';

describe('displayHost', () => {
  it('shows single-script hosts in Unicode', () => {
    expect(displayHost('https://example.com/path?q=1')).toBe('example.com');
    expect(displayHost('https://WWW.Example.COM./')).toBe('www.example.com');
    expect(displayHost('https://xn--mnchen-3ya.de/')).toBe('münchen.de');
    expect(displayHost('https://пример.рф/')).toBe('пример.рф');
    expect(displayHost('https://xn--e1afmkfd.xn--p1ai/')).toBe('пример.рф');
    expect(displayHost('https://my-site.xn--p1ai/')).toBe('my-site.рф');
    expect(displayHost('https://shop-24.ru/')).toBe('shop-24.ru');
  });

  it('falls back to punycode for mixed scripts and look-alikes', () => {
    // Cyrillic "а" inside a Latin name.
    expect(displayHost('https://xn--pple-43d.com/')).toBe('xn--pple-43d.com');
    // Whole-script Cyrillic look-alike of "apple" under a Latin TLD.
    expect(displayHost('https://xn--80ak6aa92e.com/')).toBe('xn--80ak6aa92e.com');
    // Cyrillic name under a Latin TLD: not a homograph by itself, but not provably safe either.
    expect(displayHost('https://пример.com/')).toBe('xn--e1afmkfd.com');
    // Greek is neither Latin nor Cyrillic.
    expect(displayHost('https://παράδειγμα.gr/')).toBe('xn--hxajbheg2az3al.gr');
  });

  it('rejects what is not a URL', () => {
    expect(() => displayHost('not a url')).toThrow();
  });
});
