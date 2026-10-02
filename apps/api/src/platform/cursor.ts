import { hmac, safeEqual } from './crypto.js';
import { ValidationError } from './errors/http-error.filter.js';

/**
 * Opaque, HMAC-signed pagination cursors (ADR-010): clients cannot forge or edit them, and the
 * scope ties a cursor to one list so it cannot be replayed against another.
 */
export function encodeCursor(key: Buffer, scope: string, value: Record<string, string>): string {
  const body = Buffer.from(JSON.stringify(value)).toString('base64url');
  const signature = hmac(key, `${scope}.${body}`).subarray(0, 16).toString('base64url');
  return `${body}.${signature}`;
}

export function decodeCursor(key: Buffer, scope: string, cursor: string): Record<string, string> {
  const [body, signature] = cursor.split('.');
  const invalid = () => new ValidationError([{ field: 'cursor', message: 'Invalid cursor' }]);
  if (!body || !signature) throw invalid();
  const expected = hmac(key, `${scope}.${body}`).subarray(0, 16);
  if (!safeEqual(Buffer.from(signature, 'base64url'), expected)) throw invalid();
  try {
    const value: unknown = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (typeof value !== 'object' || value === null) throw invalid();
    return value as Record<string, string>;
  } catch {
    throw invalid();
  }
}
