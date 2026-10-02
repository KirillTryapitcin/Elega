import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

const SAFE_ID = /^[A-Za-z0-9._:-]{8,128}$/;
const ASSIGNED = Symbol('elega.requestId');

type Tagged = IncomingMessage & { [ASSIGNED]?: string };

/**
 * One id per request, shared by Fastify, the pino logger and the error body.
 * Accepts Caddy's `X-Request-Id` when it looks safe, otherwise generates a UUID.
 */
export function requestIdFor(req: IncomingMessage): string {
  const tagged = req as Tagged;
  if (tagged[ASSIGNED]) return tagged[ASSIGNED];
  const incoming = req.headers['x-request-id'];
  const id = typeof incoming === 'string' && SAFE_ID.test(incoming) ? incoming : randomUUID();
  tagged[ASSIGNED] = id;
  return id;
}
