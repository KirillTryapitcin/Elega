/**
 * Plain-text hygiene for user-entered profile text (brief §20.2). Zod-free so the web can run
 * the same checks on blur.
 */

/**
 * Characters never allowed in names and profile text: bidi controls (spoofing), C0/C1 controls,
 * lone surrogates, private-use and noncharacters, zero-width space, BOM and the Unicode
 * line/paragraph separators (they break JSON-in-HTML and layouts).
 */
const FORBIDDEN = /[\p{Bidi_Control}\p{Cs}\p{Co}\p{Noncharacter_Code_Point}]/u;
/** Zero-width space, byte order mark, line separator, paragraph separator. */
const INVISIBLE: ReadonlySet<string> = new Set(
  [0x200b, 0xfeff, 0x2028, 0x2029].map((codePoint) => String.fromCodePoint(codePoint)),
);
const CONTROL = /\p{Cc}/gu;
const NEWLINE = '\n';

export interface TextRules {
  /** Allow `\n` (bio); every other control character is still rejected. */
  readonly multiline?: boolean;
}

/** True when the text contains a character that is never allowed. */
export function hasForbiddenChars(input: string, rules: TextRules = {}): boolean {
  if (FORBIDDEN.test(input)) return true;
  for (const char of input) if (INVISIBLE.has(char)) return true;
  const controls = input.match(CONTROL) ?? [];
  return controls.some((char) => !(rules.multiline && char === NEWLINE));
}

/**
 * Normalises text for storage: CRLF and CR to LF, Unicode NFC, trimmed; empty becomes null.
 * Callers then run `hasForbiddenChars` on the result (a CR is a control character).
 */
export function sanitizeProfileText(input: string): string | null {
  const normalized = input.replace(/\r\n?/g, NEWLINE).normalize('NFC').trim();
  return normalized === '' ? null : normalized;
}
