import { describe, expect, it } from 'vitest';
import { loadEnv } from './env.js';

describe('worker loadEnv', () => {
  const local = { REDIS_URL: 'redis://:elega_local_only@redis:6379' };

  it('refuses local-only credentials when APP_ENV is production (the default for prod builds)', () => {
    expect(() => loadEnv({ ...local, NODE_ENV: 'production' })).toThrowError(/REDIS_URL/);
  });

  it('accepts them for a local deployment', () => {
    expect(loadEnv({ ...local, NODE_ENV: 'production', APP_ENV: 'local' }).APP_ENV).toBe('local');
  });
});
