import { z } from 'zod';

/** Machine-readable error codes. Must match `components.schemas.Error` in docs/api/openapi.yaml. */
export const ERROR_CODES = [
  'unauthorized',
  'forbidden',
  'not_found',
  'validation_failed',
  'conflict',
  'rate_limited',
  'payload_too_large',
  'unsupported_media_type',
  'internal_error',
  'mfa_required',
  'registration_closed',
  'account_suspended',
  'account_banned',
  'reauth_required',
] as const;

export const errorCodeSchema = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

export const errorDetailSchema = z.strictObject({
  field: z.string().optional(),
  message: z.string(),
});
export type ErrorDetail = z.infer<typeof errorDetailSchema>;

/** Unified error body returned by every API endpoint (brief §20). */
export const errorBodySchema = z.strictObject({
  error: z.strictObject({
    code: errorCodeSchema,
    message: z.string(),
    details: z.array(errorDetailSchema).optional(),
    requestId: z.string(),
  }),
});
export type ErrorBody = z.infer<typeof errorBodySchema>;

/** Default HTTP status for each error code. */
export const ERROR_STATUS: Record<ErrorCode, number> = {
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  validation_failed: 400,
  conflict: 409,
  rate_limited: 429,
  payload_too_large: 413,
  unsupported_media_type: 415,
  internal_error: 500,
  mfa_required: 401,
  registration_closed: 403,
  account_suspended: 403,
  account_banned: 403,
  reauth_required: 403,
};
