import { describe, expect, it } from 'vitest';
import { loadEnv } from './env.js';

const base = {
  DATABASE_URL: 'postgres://elega:secret@localhost:5432/elega',
  REDIS_URL: 'redis://localhost:6379',
};

describe('loadEnv', () => {
  it('applies defaults', () => {
    const env = loadEnv(base);
    expect(env).toMatchObject({ NODE_ENV: 'development', PORT: 3001, TRUST_PROXY_HOPS: 0 });
  });

  it('lists every invalid variable without echoing values', () => {
    const run = () => loadEnv({ DATABASE_URL: 'mysql://x', PORT: 'abc' });
    for (const key of ['DATABASE_URL', 'PORT', 'REDIS_URL']) {
      expect(run).toThrowError(new RegExp(`${key}:`));
    }
    expect(() => loadEnv({ ...base, PORT: 'secret-value' })).not.toThrowError(/secret-value/);
  });

  it('refuses local-only credentials in production and staging', () => {
    const local = { ...base, DATABASE_URL: 'postgres://elega:elega_local_only@db:5432/elega' };
    expect(() => loadEnv({ ...local, NODE_ENV: 'production' })).toThrowError(/DATABASE_URL/);
    expect(() => loadEnv({ ...local, APP_ENV: 'staging' })).toThrowError(/DATABASE_URL/);
    expect(() => loadEnv(local)).not.toThrow();
  });

  it('allows a production build to run the local stack only when APP_ENV says so', () => {
    const local = { ...base, REDIS_URL: 'redis://:elega_local_only@redis:6379' };
    expect(loadEnv({ ...local, NODE_ENV: 'production', APP_ENV: 'local' }).APP_ENV).toBe('local');
    expect(loadEnv({ ...base, NODE_ENV: 'production' }).APP_ENV).toBe('production');
  });
});
