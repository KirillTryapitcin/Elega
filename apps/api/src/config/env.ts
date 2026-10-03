import { z } from 'zod';

const LOCAL_ONLY_MARKER = 'local_only';

/** S3 bucket naming rules: lowercase letters, digits, dots and hyphens, 3 to 63 characters. */
const bucketSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/, { message: 'expected an S3 bucket name' });

/**
 * An S3 endpoint is an origin only (scheme, host, port). Presigned URLs sign the host, and the
 * web CSP appends the bucket path to the public endpoint, so a path or credentials would break
 * both silently.
 */
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

/** `id:secret,id:secret`; each secret at least 32 characters. */
const keyListSchema = z.string().transform((value, ctx) => {
  const keys = value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const separator = entry.indexOf(':');
      return { id: entry.slice(0, separator), secret: entry.slice(separator + 1) };
    });
  const ids = new Set(keys.map((key) => key.id));
  const valid =
    keys.length > 0 &&
    ids.size === keys.length &&
    keys.every((key) => /^[A-Za-z0-9_-]{1,32}$/.test(key.id) && key.secret.length >= 32);
  if (!valid) {
    ctx.addIssue({
      code: 'custom',
      message: 'expected id:secret pairs, secrets of 32+ characters',
    });
    return z.NEVER;
  }
  return keys;
});

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    /**
     * Where this process runs. NODE_ENV only says how the code was built; APP_ENV decides
     * whether production safeguards apply. Defaults to `production` for production builds,
     * so forgetting it fails safe.
     */
    APP_ENV: z.enum(['local', 'test', 'staging', 'production']).optional(),
    HOST: z.string().default('0.0.0.0'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3001),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
    REDIS_URL: z.url({ protocol: /^rediss?$/ }),
    /** Fastify `trustProxy`: number of trusted hops in front of the API (Caddy = 1). */
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
    /** Public origin of the web app (links in emails, Origin checks, OAuth redirect URIs). */
    APP_BASE_URL: z.url({ protocol: /^https?$/ }).transform((url) => url.replace(/\/+$/, '')),
    /**
     * Root secret, at least 32 random characters. Purpose-specific keys (IP hashing, cursor and
     * state signing, and by default JWT and TOTP keys) are derived from it with HKDF.
     */
    APP_SECRET: z.string().min(32),
    /** Optional `kid:secret` list, newest first; tokens are signed with the first key. */
    AUTH_JWT_KEYS: keyListSchema.optional(),
    /** Optional `version:secret` list for TOTP secret encryption, newest first. */
    AUTH_TOTP_KEYS: keyListSchema.optional(),
    REGISTRATION_MODE: z.enum(['invite_only', 'open', 'closed']).default('invite_only'),
    LEGAL_TERMS_VERSION: z.string().min(1).default('2026-10-01'),
    LEGAL_PRIVACY_VERSION: z.string().min(1).default('2026-10-01'),
    LEGAL_PD_PROCESSING_VERSION: z.string().min(1).default('2026-10-01'),
    /** Version of the Art. 10.1 consent text; a bump invalidates earlier consents. */
    LEGAL_PD_DISSEMINATION_VERSION: z.string().min(1).default('2026-10-01'),
    /** S3 API endpoint the API itself calls (HEAD, PUT, health check). */
    S3_ENDPOINT: s3EndpointSchema,
    /** Endpoint the browser reaches; presigned URLs are signed for this host. */
    S3_PUBLIC_ENDPOINT: s3EndpointSchema,
    S3_REGION: z.string().min(1).default('us-east-1'),
    /** Credentials of the API's own storage identity (no list, no bucket admin). */
    S3_ACCESS_KEY: z.string().min(1),
    S3_SECRET_KEY: z.string().min(1),
    S3_BUCKET_PRIVATE: bucketSchema,
    /** Provisioned for public-audience content later; unused in M2 but validated. */
    S3_BUCKET_PUBLIC: bucketSchema,
    /** Path-style URLs (`endpoint/bucket/key`); SeaweedFS and most RU providers need them. */
    S3_FORCE_PATH_STYLE: z.stringbool({ truthy: ['true'], falsy: ['false'] }).default(true),
    VK_CLIENT_ID: z.string().min(1).optional(),
    YANDEX_CLIENT_ID: z.string().min(1).optional(),
    YANDEX_CLIENT_SECRET: z.string().min(1).optional(),
    GOOGLE_CLIENT_ID: z.string().min(1).optional(),
    GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
  })
  .transform((env) => ({
    ...env,
    APP_ENV: env.APP_ENV ?? (env.NODE_ENV === 'production' ? 'production' : 'local'),
  }))
  .superRefine((env, ctx) => {
    if (env.S3_BUCKET_PRIVATE === env.S3_BUCKET_PUBLIC) {
      ctx.addIssue({
        code: 'custom',
        path: ['S3_BUCKET_PUBLIC'],
        message: 'must differ from S3_BUCKET_PRIVATE',
      });
    }
    if (env.APP_ENV !== 'production' && env.APP_ENV !== 'staging') return;
    // Local compose credentials carry a marker so they can never boot a production process.
    for (const [key, value] of Object.entries(env)) {
      const text = typeof value === 'string' ? value : JSON.stringify(value ?? '');
      if (text.includes(LOCAL_ONLY_MARKER)) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: `contains a local-only credential, refusing to start in production`,
        });
      }
    }
    if (!env.APP_BASE_URL.startsWith('https://')) {
      ctx.addIssue({ code: 'custom', path: ['APP_BASE_URL'], message: 'must be https' });
    }
    // Signed media URLs travel to browsers; plain http would leak them and break mixed content.
    if (!env.S3_PUBLIC_ENDPOINT.startsWith('https://')) {
      ctx.addIssue({ code: 'custom', path: ['S3_PUBLIC_ENDPOINT'], message: 'must be https' });
    }
  });

export type Env = z.infer<typeof envSchema>;

/** Parses and validates the environment. Throws with every problem listed, never the values. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }
  return result.data;
}

export const ENV = Symbol('ENV');
