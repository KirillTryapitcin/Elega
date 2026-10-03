import { z } from 'zod';

/**
 * `core`: outbox relay, email, system heartbeat. `media`: media processing, sweep, cleanup and
 * the kill-switch poller. One process may run both (the default, for `pnpm dev`).
 */
export const WORKER_ROLE_NAMES = ['core', 'media'] as const;
export type WorkerRole = (typeof WORKER_ROLE_NAMES)[number];

/** Variables each role needs; loadEnv requires them only when the role is enabled. */
const ROLE_REQUIREMENTS = {
  core: ['SMTP_URL'],
  media: ['S3_ENDPOINT', 'S3_ACCESS_KEY', 'S3_SECRET_KEY', 'S3_BUCKET_PRIVATE', 'S3_BUCKET_PUBLIC'],
} as const satisfies Record<WorkerRole, readonly string[]>;

/** S3 bucket naming rules: lowercase letters, digits, dots and hyphens, 3 to 63 characters. */
const bucketSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/, { message: 'expected an S3 bucket name' });

/** Origin only (scheme, host, port); see apps/api/src/config/env.ts. */
const s3EndpointSchema = z.url({ protocol: /^https?$/ }).transform((value, ctx) => {
  const url = new URL(value);
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    ctx.addIssue({
      code: 'custom',
      message: 'expected an origin without path, query or credentials',
    });
    return z.NEVER;
  }
  return url.origin;
});

const booleanSchema = z.stringbool({ truthy: ['true'], falsy: ['false'] });

const rolesSchema = z
  .string()
  .default(WORKER_ROLE_NAMES.join(','))
  .transform((value) =>
    value
      .split(',')
      .map((role) => role.trim())
      .filter(Boolean),
  )
  .pipe(z.array(z.enum(WORKER_ROLE_NAMES)).min(1, { message: 'expected at least one role' }))
  .transform((roles): readonly WorkerRole[] => [...new Set(roles)]);

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    /** See apps/api/src/config/env.ts: production safeguards follow APP_ENV, not NODE_ENV. */
    APP_ENV: z.enum(['local', 'test', 'staging', 'production']).optional(),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    /** Comma list of roles this process runs (`core`, `media`). */
    WORKER_ROLES: rolesSchema,
    REDIS_URL: z.url({ protocol: /^rediss?$/ }),
    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    /** smtp:// (STARTTLS when offered) or smtps://; Mailpit locally. Required with `core`. */
    SMTP_URL: z.url({ protocol: /^smtps?$/ }).optional(),
    MAIL_FROM: z.string().min(3).default('Элега <no-reply@elega.ru>'),
    /** Public origin of the web app; links in emails point here. */
    APP_BASE_URL: z.url({ protocol: /^https?$/ }).transform((url) => url.replace(/\/+$/, '')),
    /** How often the outbox relay polls for new events. */
    OUTBOX_POLL_MS: z.coerce.number().int().min(100).default(1_000),
    /** Health (and metrics) server port; 0 picks a free port (tests only). */
    HEALTH_PORT: z.coerce.number().int().min(0).max(65535).default(3002),
    /** How often the heartbeat job runs; health turns red after three missed beats. */
    HEARTBEAT_EVERY_MS: z.coerce.number().int().min(1_000).default(60_000),
    /** Serve Prometheus metrics at /metrics on the health server. */
    METRICS_ENABLED: booleanSchema.default(true),
    /** Object storage, required with `media`: the worker's own identity (list, no bucket admin). */
    S3_ENDPOINT: s3EndpointSchema.optional(),
    S3_REGION: z.string().min(1).default('us-east-1'),
    S3_ACCESS_KEY: z.string().min(1).optional(),
    S3_SECRET_KEY: z.string().min(1).optional(),
    S3_BUCKET_PRIVATE: bucketSchema.optional(),
    S3_BUCKET_PUBLIC: bucketSchema.optional(),
    S3_FORCE_PATH_STYLE: booleanSchema.default(true),
    /** Media jobs processed in parallel by one process; each decodes one image. */
    MEDIA_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(2),
    /** `clamd` scans every upload over INSTREAM; `off` skips scanning (local only). */
    ANTIVIRUS_MODE: z.enum(['off', 'clamd']).default('off'),
    CLAMAV_HOST: z.string().min(1).optional(),
    CLAMAV_PORT: z.coerce.number().int().min(1).max(65535).default(3310),
    /** Upper bound for one scan, connect to verdict; a timeout fails the job (retried). */
    CLAMAV_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(600_000).default(30_000),
  })
  .transform((env) => ({
    ...env,
    APP_ENV: env.APP_ENV ?? (env.NODE_ENV === 'production' ? 'production' : 'local'),
  }))
  .superRefine((env, ctx) => {
    for (const role of env.WORKER_ROLES) {
      for (const key of ROLE_REQUIREMENTS[role]) {
        if (env[key] === undefined) {
          ctx.addIssue({ code: 'custom', path: [key], message: `required by role ${role}` });
        }
      }
    }
    const media = env.WORKER_ROLES.includes('media');
    if (media && env.S3_BUCKET_PRIVATE && env.S3_BUCKET_PRIVATE === env.S3_BUCKET_PUBLIC) {
      ctx.addIssue({
        code: 'custom',
        path: ['S3_BUCKET_PUBLIC'],
        message: 'must differ from S3_BUCKET_PRIVATE',
      });
    }
    if (media && env.ANTIVIRUS_MODE === 'clamd' && env.CLAMAV_HOST === undefined) {
      ctx.addIssue({ code: 'custom', path: ['CLAMAV_HOST'], message: 'required by clamd' });
    }

    const guarded = env.APP_ENV === 'production' || env.APP_ENV === 'staging';
    if (!guarded) return;
    for (const [key, value] of Object.entries(env)) {
      if (typeof value === 'string' && value.includes('local_only')) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: 'local-only credential in production',
        });
      }
    }
    if (!env.APP_BASE_URL.startsWith('https://')) {
      ctx.addIssue({ code: 'custom', path: ['APP_BASE_URL'], message: 'must be https' });
    }
    // The container healthcheck probes a fixed port.
    if (env.HEALTH_PORT === 0) {
      ctx.addIssue({ code: 'custom', path: ['HEALTH_PORT'], message: 'must be a fixed port' });
    }
    // Brief §37.1: uploads are never processed unscanned outside local and test.
    if (media && env.ANTIVIRUS_MODE === 'off') {
      ctx.addIssue({ code: 'custom', path: ['ANTIVIRUS_MODE'], message: 'must be clamd' });
    }
  });

export type Env = z.infer<typeof envSchema>;

/** SMTP settings; present whenever the `core` role is enabled (loadEnv enforces it). */
export type CoreEnv = Env & { SMTP_URL: string };

/** Storage settings; present whenever the `media` role is enabled (loadEnv enforces it). */
export type MediaEnv = Env & {
  S3_ENDPOINT: string;
  S3_ACCESS_KEY: string;
  S3_SECRET_KEY: string;
  S3_BUCKET_PRIVATE: string;
  S3_BUCKET_PUBLIC: string;
};

/** clamd settings; present whenever ANTIVIRUS_MODE is `clamd` for a media worker. */
export type ClamdEnv = MediaEnv & { ANTIVIRUS_MODE: 'clamd'; CLAMAV_HOST: string };

export function hasCoreRole(env: Env): env is CoreEnv {
  return env.WORKER_ROLES.includes('core');
}

export function hasMediaRole(env: Env): env is MediaEnv {
  return env.WORKER_ROLES.includes('media');
}

export function usesClamd(env: MediaEnv): env is ClamdEnv {
  return env.ANTIVIRUS_MODE === 'clamd';
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const problems = result.error.issues
      .map((i) => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }
  return result.data;
}
