import { z } from 'zod';

/** Page size when the client sends none, and the most one request may ask for. */
export const PAGE_SIZE_DEFAULT = 20;
export const PAGE_SIZE_MAX = 50;
/** Cursors are HMAC-signed and scoped (`cursor.ts`); anything longer is not one of ours. */
const CURSOR_MAX_LENGTH = 512;

/** `?limit=&cursor=` on every paged list (`{ data, page: { nextCursor, hasMore } }`). */
export const pageQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(PAGE_SIZE_MAX).default(PAGE_SIZE_DEFAULT),
  cursor: z.string().max(CURSOR_MAX_LENGTH).optional(),
});
export type PageQuery = z.infer<typeof pageQuerySchema>;

/** `:id` path parameters; anything else is a 400 before a query runs. */
export const uuidParamSchema = z.uuid();
