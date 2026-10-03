import { z } from 'zod';

export const healthStatusSchema = z.enum(['ok', 'degraded', 'down']);

export const healthSchema = z.strictObject({
  status: healthStatusSchema,
  checks: z.record(z.string(), z.string()).optional(),
});
export type Health = z.infer<typeof healthSchema>;
