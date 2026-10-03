import { describe, expect, it } from 'vitest';
import { hasCoreRole, hasMediaRole, loadEnv, usesClamd } from './env.js';

describe('worker loadEnv', () => {
  const storage = {
    S3_ENDPOINT: 'http://s3:8333',
    S3_ACCESS_KEY: 'elega_local_only_worker',
    S3_SECRET_KEY: 'elega_local_only_worker_secret',
    S3_BUCKET_PRIVATE: 'elega-private',
    S3_BUCKET_PUBLIC: 'elega-public',
  };
  const local = {
    REDIS_URL: 'redis://:elega_local_only@redis:6379',
    DATABASE_URL: 'postgres://elega:elega_local_only@postgres:5432/elega',
    SMTP_URL: 'smtp://mailpit:1025',
    APP_BASE_URL: 'https://elega.test',
    ...storage,
  };
  const prod = {
    NODE_ENV: 'production',
    REDIS_URL: 'rediss://:redis-password@redis.internal:6380',
    DATABASE_URL: 'postgres://elega:db-password@db.internal:5432/elega',
    SMTP_URL: 'smtps://mailer:smtp-password@smtp.internal:465',
    APP_BASE_URL: 'https://elega.ru',
    S3_ENDPOINT: 'https://storage.example.ru',
    S3_ACCESS_KEY: 'worker-access-key',
    S3_SECRET_KEY: 's'.repeat(40),
    S3_BUCKET_PRIVATE: 'elega-private',
    S3_BUCKET_PUBLIC: 'elega-public',
    ANTIVIRUS_MODE: 'clamd',
    CLAMAV_HOST: 'clamav.internal',
  };

  it('refuses local-only credentials when APP_ENV is production (the default for prod builds)', () => {
    expect(() => loadEnv({ ...local, NODE_ENV: 'production' })).toThrowError(/REDIS_URL/);
    expect(() => loadEnv({ ...local, NODE_ENV: 'production' })).toThrowError(/S3_SECRET_KEY/);
  });

  it('accepts them for a local deployment', () => {
    expect(loadEnv({ ...local, NODE_ENV: 'production', APP_ENV: 'local' }).APP_ENV).toBe('local');
  });

  it('runs both roles by default with local defaults', () => {
    const env = loadEnv(local);
    expect(env).toMatchObject({
      WORKER_ROLES: ['core', 'media'],
      HEALTH_PORT: 3002,
      METRICS_ENABLED: true,
      MEDIA_CONCURRENCY: 2,
      ANTIVIRUS_MODE: 'off',
      CLAMAV_PORT: 3310,
      CLAMAV_TIMEOUT_MS: 30_000,
      S3_REGION: 'us-east-1',
      S3_FORCE_PATH_STYLE: true,
    });
    expect(hasCoreRole(env) && hasMediaRole(env)).toBe(true);
  });

  it('accepts a valid production configuration', () => {
    const env = loadEnv(prod);
    expect(env.APP_ENV).toBe('production');
    expect(hasMediaRole(env) && usesClamd(env) && env.CLAMAV_HOST).toBe('clamav.internal');
  });

  it('requires SMTP only with the core role', () => {
    const noSmtp = Object.fromEntries(Object.entries(local).filter(([key]) => key !== 'SMTP_URL'));
    expect(() => loadEnv(noSmtp)).toThrowError(/SMTP_URL: required by role core/);
    const env = loadEnv({ ...noSmtp, WORKER_ROLES: 'media' });
    expect(env.WORKER_ROLES).toEqual(['media']);
    expect(hasCoreRole(env)).toBe(false);
  });

  it('requires storage only with the media role', () => {
    const noStorage = Object.fromEntries(
      Object.entries(local).filter(([key]) => !(key in storage)),
    );
    const run = () => loadEnv(noStorage);
    for (const key of Object.keys(storage)) {
      expect(run).toThrowError(new RegExp(`${key}: required by role media`));
    }
    const env = loadEnv({ ...noStorage, WORKER_ROLES: 'core' });
    expect(hasMediaRole(env)).toBe(false);
  });

  it('parses the role list strictly', () => {
    expect(loadEnv({ ...local, WORKER_ROLES: ' media , core,media ' }).WORKER_ROLES).toEqual([
      'media',
      'core',
    ]);
    expect(() => loadEnv({ ...local, WORKER_ROLES: 'core,video' })).toThrowError(/WORKER_ROLES/);
    expect(() => loadEnv({ ...local, WORKER_ROLES: ' , ' })).toThrowError(/WORKER_ROLES/);
  });

  it('validates storage settings for media workers', () => {
    expect(() => loadEnv({ ...local, S3_ENDPOINT: 'http://s3:8333/bucket' })).toThrowError(
      /S3_ENDPOINT/,
    );
    expect(() => loadEnv({ ...local, S3_BUCKET_PUBLIC: 'elega-private' })).toThrowError(
      /S3_BUCKET_PUBLIC: must differ/,
    );
    expect(loadEnv({ ...local, S3_FORCE_PATH_STYLE: 'false' }).S3_FORCE_PATH_STYLE).toBe(false);
  });

  it('needs a clamd host when scanning is on', () => {
    expect(() => loadEnv({ ...local, ANTIVIRUS_MODE: 'clamd' })).toThrowError(
      /CLAMAV_HOST: required by clamd/,
    );
    const env = loadEnv({ ...local, ANTIVIRUS_MODE: 'clamd', CLAMAV_HOST: 'clamav' });
    expect(hasMediaRole(env) && usesClamd(env)).toBe(true);
    expect(() => loadEnv({ ...local, ANTIVIRUS_MODE: 'clamav' })).toThrowError(/ANTIVIRUS_MODE/);
  });

  it('refuses unscanned uploads and an ephemeral health port in production and staging', () => {
    expect(() => loadEnv({ ...prod, ANTIVIRUS_MODE: 'off' })).toThrowError(
      /ANTIVIRUS_MODE: must be clamd/,
    );
    expect(() => loadEnv({ ...prod, APP_ENV: 'staging', ANTIVIRUS_MODE: 'off' })).toThrowError(
      /ANTIVIRUS_MODE/,
    );
    // A core-only worker never touches uploads.
    expect(loadEnv({ ...prod, WORKER_ROLES: 'core', ANTIVIRUS_MODE: 'off' }).APP_ENV).toBe(
      'production',
    );
    expect(() => loadEnv({ ...prod, HEALTH_PORT: '0' })).toThrowError(/HEALTH_PORT/);
    expect(loadEnv({ ...local, HEALTH_PORT: '0' }).HEALTH_PORT).toBe(0);
  });

  it('parses the metrics and concurrency settings', () => {
    expect(loadEnv({ ...local, METRICS_ENABLED: 'false' }).METRICS_ENABLED).toBe(false);
    expect(() => loadEnv({ ...local, METRICS_ENABLED: '0' })).toThrowError(/METRICS_ENABLED/);
    expect(loadEnv({ ...local, MEDIA_CONCURRENCY: '4' }).MEDIA_CONCURRENCY).toBe(4);
    expect(() => loadEnv({ ...local, MEDIA_CONCURRENCY: '0' })).toThrowError(/MEDIA_CONCURRENCY/);
  });
});
