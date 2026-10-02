import { z } from 'zod';

const LOCAL_ONLY_MARKER = 'local_only';

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
  })
  .transform((env) => ({
    ...env,
    APP_ENV: env.APP_ENV ?? (env.NODE_ENV === 'production' ? 'production' : 'local'),
  }))
  .superRefine((env, ctx) => {
    if (env.APP_ENV !== 'production' && env.APP_ENV !== 'staging') return;
    // Local compose credentials carry a marker so they can never boot a production process.
    for (const [key, value] of Object.entries(env)) {
      if (typeof value === 'string' && value.includes(LOCAL_ONLY_MARKER)) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: `contains a local-only credential, refusing to start in production`,
        });
      }
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
