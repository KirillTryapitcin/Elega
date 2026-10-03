import { z } from 'zod';

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    /** See apps/api/src/config/env.ts: production safeguards follow APP_ENV, not NODE_ENV. */
    APP_ENV: z.enum(['local', 'test', 'staging', 'production']).optional(),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    REDIS_URL: z.url({ protocol: /^rediss?$/ }),
    HEALTH_PORT: z.coerce.number().int().min(1).max(65535).default(3002),
    /** How often the heartbeat job runs; health turns red after three missed beats. */
    HEARTBEAT_EVERY_MS: z.coerce.number().int().min(1_000).default(60_000),
  })
  .transform((env) => ({
    ...env,
    APP_ENV: env.APP_ENV ?? (env.NODE_ENV === 'production' ? 'production' : 'local'),
  }))
  .superRefine((env, ctx) => {
    const guarded = env.APP_ENV === 'production' || env.APP_ENV === 'staging';
    if (guarded && env.REDIS_URL.includes('local_only')) {
      ctx.addIssue({
        code: 'custom',
        path: ['REDIS_URL'],
        message: 'local-only credential in production',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

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
