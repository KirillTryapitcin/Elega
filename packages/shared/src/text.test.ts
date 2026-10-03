import { describe, expect, it } from 'vitest';
import { hasForbiddenChars, sanitizeProfileText } from './text.js';

// Built from code points so the source file itself stays free of invisible characters.
const char = (codePoint: number) => String.fromCodePoint(codePoint);

describe('hasForbiddenChars', () => {
  it('allows ordinary text, emoji and joiners', () => {
    expect(hasForbiddenChars('Анна Петрова')).toBe(false);
    expect(hasForbiddenChars(`family ${char(0x1f468)}${char(0x200d)}${char(0x1f469)}`)).toBe(false);
    expect(hasForbiddenChars('tab-free text with café')).toBe(false);
  });

  const forbidden: [string, number][] = [
    ['right-to-left override', 0x202e],
    ['left-to-right isolate', 0x2066],
    ['right-to-left mark', 0x200f],
    ['zero-width space', 0x200b],
    ['byte order mark', 0xfeff],
    ['line separator', 0x2028],
    ['paragraph separator', 0x2029],
    ['private use', 0xe000],
    ['noncharacter', 0xfffe],
    ['NUL', 0x0000],
    ['bell', 0x0007],
    ['DEL', 0x007f],
    ['C1 control', 0x0085],
    ['carriage return', 0x000d],
    ['tab', 0x0009],
  ];
  it.each(forbidden)('rejects %s', (_name, codePoint) => {
    expect(hasForbiddenChars(`a${char(codePoint)}b`)).toBe(true);
    expect(hasForbiddenChars(`a${char(codePoint)}b`, { multiline: true })).toBe(true);
  });

  it('rejects a lone surrogate', () => {
    expect(hasForbiddenChars(`a${String.fromCharCode(0xd800)}b`)).toBe(true);
  });

  it('allows a newline only in multiline text', () => {
    expect(hasForbiddenChars('line one\nline two')).toBe(true);
    expect(hasForbiddenChars('line one\nline two', { multiline: true })).toBe(false);
  });
});

describe('sanitizeProfileText', () => {
  it('trims, normalises line endings and NFC, and maps empty to null', () => {
    expect(sanitizeProfileText('  hello  ')).toBe('hello');
    expect(sanitizeProfileText('a\r\nb\rc')).toBe('a\nb\nc');
    expect(sanitizeProfileText(`cafe${char(0x0301)}`)).toBe(`caf${char(0x00e9)}`);
    expect(sanitizeProfileText('   ')).toBeNull();
    expect(sanitizeProfileText('')).toBeNull();
  });
});
