import { describe, expect, it } from 'vitest';
import { parseFlagArgs } from './flag-command.js';

describe('flags CLI arguments', () => {
  it('accepts set <known key> on|off', () => {
    expect(parseFlagArgs(['set', 'media.uploads_paused', 'on'])).toEqual({
      key: 'media.uploads_paused',
      enabled: true,
    });
    expect(parseFlagArgs(['set', 'profiles.public_access', 'off'])).toEqual({
      key: 'profiles.public_access',
      enabled: false,
    });
  });

  it('refuses unknown keys, values and commands with the usage text', () => {
    expect(() => parseFlagArgs(['set', 'media.upload_paused', 'on'])).toThrow(
      /Unknown flag "media.upload_paused"[\s\S]*Keys: auth.google/,
    );
    expect(() => parseFlagArgs(['set', 'auth.google', 'yes'])).toThrow(/Expected on or off/);
    expect(() => parseFlagArgs(['get', 'auth.google'])).toThrow(/Usage: flags set/);
    expect(() => parseFlagArgs([])).toThrow(/Usage: flags set/);
    expect(() => parseFlagArgs(['set', 'auth.google', 'on', 'extra'])).toThrow(/Usage/);
  });
});
