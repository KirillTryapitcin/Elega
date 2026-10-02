import type { IncomingMessage } from 'node:http';
import { describe, expect, it } from 'vitest';
import { requestIdFor } from './request-id.js';

const req = (header?: string) =>
  ({ headers: header === undefined ? {} : { 'x-request-id': header } }) as IncomingMessage;

describe('requestIdFor', () => {
  it('reuses a safe incoming id', () => {
    expect(requestIdFor(req('caddy-0123456789'))).toBe('caddy-0123456789');
  });

  it('replaces unsafe or missing ids', () => {
    expect(requestIdFor(req('bad id\nwith newline'))).toMatch(/^[0-9a-f-]{36}$/);
    expect(requestIdFor(req())).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('is stable for the same request', () => {
    const r = req();
    expect(requestIdFor(r)).toBe(requestIdFor(r));
  });
});
