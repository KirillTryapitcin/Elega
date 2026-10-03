import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { hmac } from './crypto.js';
import { AppError } from './errors/app-error.js';

/**
 * Every route requires a valid access token unless marked `@Public()`. The guard that enforces
 * this lives in the auth module; the marker lives here so platform routes (health) can use it.
 */
export const IS_PUBLIC = 'elega:isPublic';
export const Public = () => SetMetadata(IS_PUBLIC, true);

/**
 * The route needs a confirmed email address on top of a valid token: 403 `forbidden` with the
 * detail `email_not_verified` otherwise (media uploads, avatar and cover). Checked by the guard
 * from the token's `ev` claim, so a freshly verified account refreshes its token first.
 */
export const REQUIRES_VERIFIED_EMAIL = 'elega:requiresVerifiedEmail';
export const RequireVerifiedEmail = () => SetMetadata(REQUIRES_VERIFIED_EMAIL, true);

/** The caller, as established by the access token. */
export interface AuthUser {
  id: string;
  sessionId: string;
  role: 'user' | 'moderator' | 'analyst' | 'admin';
  minor: boolean;
  /** Email confirmed when the token was issued (claim `ev`). */
  emailVerified: boolean;
}

declare module 'fastify' {
  interface FastifyRequest {
    authUser?: AuthUser;
    /** A bearer token was sent but is invalid, expired or revoked (set on public routes). */
    bearerRejected?: boolean;
  }
}

/** The 403 for unverified accounts; services reuse it for checks that depend on the body. */
export function emailNotVerified(field?: string): AppError {
  return new AppError('forbidden', 'Confirm your email address first', [
    { ...(field ? { field } : {}), message: 'email_not_verified' },
  ]);
}

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const user = ctx.switchToHttp().getRequest<FastifyRequest>().authUser;
  // Only reachable on a public route that forgot to check; fail closed.
  if (!user) throw new Error('CurrentUser used on a route without an authenticated user');
  return user;
});

/**
 * The viewer on a `@Public()` route that tailors its answer to the caller: `null` without a
 * bearer token. A token that is present but invalid, expired or revoked is a 401, not an
 * anonymous view, so the client refreshes and retries instead of showing what anonymous
 * visitors get (for a profile, "unavailable").
 */
export const OptionalUser = createParamDecorator((_data: unknown, ctx: ExecutionContext) =>
  optionalUser(ctx.switchToHttp().getRequest<FastifyRequest>()),
);

export function optionalUser(
  request: Pick<FastifyRequest, 'authUser' | 'bearerRejected'>,
): AuthUser | null {
  if (request.bearerRejected) throw new AppError('unauthorized', 'Authentication required');
  return request.authUser ?? null;
}

export interface ClientInfo {
  ip: string;
  userAgent: string;
}

export const Client = createParamDecorator((_data: unknown, ctx: ExecutionContext) =>
  clientInfo(ctx.switchToHttp().getRequest<FastifyRequest>()),
);

export function clientInfo(request: FastifyRequest): ClientInfo {
  const agent = request.headers['user-agent'];
  return { ip: request.ip, userAgent: (typeof agent === 'string' ? agent : '').slice(0, 512) };
}

/** Keyed hash of an IP address: comparable for rate limits and abuse checks, not reversible. */
export function hashIp(key: Buffer, ip: string): Buffer {
  return hmac(key, `ip:${ip}`);
}
