import { describe, expect, it } from 'vitest';
import { loadEnv } from './env.js';

const base = {
  DATABASE_URL: 'postgres://elega:secret@localhost:5432/elega',
  REDIS_URL: 'redis://localhost:6379',
  APP_BASE_URL: 'https://elega.test/',
  APP_SECRET: 'x'.repeat(40),
  S3_ENDPOINT: 'http://s3.internal:8333',
  S3_PUBLIC_ENDPOINT: 'https://media.elega.test/',
  S3_ACCESS_KEY: 'api-access-key',
  S3_SECRET_KEY: 's'.repeat(40),
  S3_BUCKET_PRIVATE: 'elega-private',
  S3_BUCKET_PUBLIC: 'elega-public',
};

describe('loadEnv', () => {
  it('applies defaults', () => {
    const env = loadEnv(base);
    expect(env).toMatchObject({ NODE_ENV: 'development', PORT: 3001, TRUST_PROXY_HOPS: 0 });
    expect(env).toMatchObject({
      LEGAL_PD_DISSEMINATION_VERSION: '2026-10-01',
      S3_REGION: 'us-east-1',
      S3_FORCE_PATH_STYLE: true,
      S3_PUBLIC_ENDPOINT: 'https://media.elega.test',
    });
  });

  it('requires the storage settings and lists each missing one', () => {
    const required = ['S3_ENDPOINT', 'S3_ACCESS_KEY', 'S3_BUCKET_PRIVATE'];
    const run = () =>
      loadEnv(Object.fromEntries(Object.entries(base).filter(([key]) => !required.includes(key))));
    for (const key of required) {
      expect(run).toThrowError(new RegExp(`${key}:`));
    }
  });

  it('accepts storage endpoints only as origins', () => {
    for (const value of [
      'https://media.elega.test/elega-private',
      'https://user:pass@media.elega.test',
      'https://media.elega.test/?x=1',
      'ftp://media.elega.test',
    ]) {
      expect(() => loadEnv({ ...base, S3_PUBLIC_ENDPOINT: value })).toThrowError(
        /S3_PUBLIC_ENDPOINT/,
      );
    }
    expect(loadEnv({ ...base, S3_ENDPOINT: 'http://s3:8333/' }).S3_ENDPOINT).toBe('http://s3:8333');
  });

  it('validates bucket names, keeps the buckets apart and parses the path-style flag', () => {
    expect(() => loadEnv({ ...base, S3_BUCKET_PRIVATE: 'Elega_Private' })).toThrowError(
      /S3_BUCKET_PRIVATE/,
    );
    expect(() => loadEnv({ ...base, S3_BUCKET_PUBLIC: 'elega-private' })).toThrowError(
      /S3_BUCKET_PUBLIC: must differ/,
    );
    expect(loadEnv({ ...base, S3_FORCE_PATH_STYLE: 'false' }).S3_FORCE_PATH_STYLE).toBe(false);
    expect(() => loadEnv({ ...base, S3_FORCE_PATH_STYLE: 'yes' })).toThrowError(
      /S3_FORCE_PATH_STYLE/,
    );
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

  it('parses key lists and rejects short secrets', () => {
    const env = loadEnv({ ...base, AUTH_JWT_KEYS: `k2:${'a'.repeat(32)}, k1:${'b'.repeat(32)}` });
    expect(env.AUTH_JWT_KEYS?.map((key) => key.id)).toEqual(['k2', 'k1']);
    expect(env.APP_BASE_URL).toBe('https://elega.test');
    expect(() => loadEnv({ ...base, AUTH_JWT_KEYS: 'k1:short' })).toThrowError(/AUTH_JWT_KEYS/);
  });

  it('requires https and real secrets in production', () => {
    const prod = { ...base, NODE_ENV: 'production' };
    expect(() => loadEnv({ ...prod, APP_BASE_URL: 'http://elega.test' })).toThrowError(/https/);
    expect(() =>
      loadEnv({ ...prod, APP_SECRET: 'elega_local_only_secret_0123456789abcdef' }),
    ).toThrowError(/APP_SECRET/);
  });

  it('requires an https media endpoint and real storage credentials in production', () => {
    const prod = { ...base, NODE_ENV: 'production' };
    const plain = { ...prod, S3_PUBLIC_ENDPOINT: 'http://localhost:8333' };
    expect(() => loadEnv(plain)).toThrowError(/S3_PUBLIC_ENDPOINT: must be https/);
    expect(() => loadEnv({ ...plain, NODE_ENV: 'development' })).not.toThrow();
    const local = {
      ...prod,
      S3_ACCESS_KEY: 'elega_local_only_api',
      S3_SECRET_KEY: 'elega_local_only_api_secret',
    };
    const run = () => loadEnv({ ...local, APP_ENV: 'staging' });
    expect(run).toThrowError(/S3_ACCESS_KEY/);
    expect(run).toThrowError(/S3_SECRET_KEY/);
    expect(run).not.toThrowError(/elega_local_only_api/);
  });
});
