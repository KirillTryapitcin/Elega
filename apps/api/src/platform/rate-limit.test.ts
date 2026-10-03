import { describe, expect, it } from 'vitest';
import { RATE_RULES, rateSubject } from './rate-limit.js';
import type { AuthUser } from './request-context.js';

const member: AuthUser = {
  id: '0190f5c0-0000-7000-8000-000000000001',
  sessionId: '0190f5c0-0000-7000-8000-000000000002',
  role: 'user',
  minor: false,
  emailVerified: true,
};

describe('rateSubject', () => {
  it('keys user rules by the member and falls back to the IP for anonymous callers', () => {
    const rule = RATE_RULES['profile.read'];
    expect(rateSubject(rule, { ip: '203.0.113.7', authUser: member })).toBe(member.id);
    expect(rateSubject(rule, { ip: '203.0.113.7' })).toBe('203.0.113.7');
  });

  it('keys IP rules by the IP even for members', () => {
    expect(rateSubject(RATE_RULES['auth.login'], { ip: '203.0.113.7', authUser: member })).toBe(
      '203.0.113.7',
    );
  });
});
