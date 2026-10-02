import { z } from 'zod';

const LOCAL_ONLY_MARKER = 'local_only';

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
