import { describe, expect, it } from 'vitest';
import { assertSeedAllowed, parseInviteArgs } from './guard.js';

describe('seed guard', () => {
  it('runs only against local and test databases', () => {
    expect(() => assertSeedAllowed({ APP_ENV: 'local' })).not.toThrow();
    expect(() => assertSeedAllowed({ APP_ENV: 'test' })).not.toThrow();
    expect(() => assertSeedAllowed({ APP_ENV: 'staging' })).toThrow(/Refusing to seed/);
    expect(() => assertSeedAllowed({ APP_ENV: 'production' })).toThrow(/Refusing to seed/);
  });
});

describe('invite CLI arguments', () => {
  it('has safe defaults and validates ranges', () => {
    expect(parseInviteArgs([])).toEqual({ count: 1, maxUses: 1, expiresDays: 30, note: null });
    expect(parseInviteArgs(['--count', '5', '--expires-days', '0', '--note', 'wave 1'])).toEqual({
      count: 5,
      maxUses: 1,
      expiresDays: 0,
      note: 'wave 1',
    });
    expect(() => parseInviteArgs(['--count', '0'])).toThrow(/--count/);
    expect(() => parseInviteArgs(['--count', '1.5'])).toThrow(/--count/);
    expect(() => parseInviteArgs(['--bogus', '1'])).toThrow(/Unknown option/);
  });
});
