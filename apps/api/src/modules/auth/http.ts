import type {} from '@fastify/cookie';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from '../../platform/errors/app-error.js';
import type { IssuedSession } from './sessions.service.js';

/** ADR-004: the `__Host-` prefix pins the cookie to this host, Secure and Path=/. */
export const REFRESH_COOKIE = '__Host-elega_rt';
/**
 * Readable by scripts and carries no secret: it only tells the web app that a refresh cookie
 * probably exists, so anonymous visitors don't call /auth/refresh on every page load.
 */
export const SIGNED_IN_HINT_COOKIE = '__Host-elega_signed_in';

export function setRefreshCookie(reply: FastifyReply, session: IssuedSession): void {
  // Without "remember this device" the cookies live for the browser session only.
  const lifetime = session.remember
    ? { maxAge: Math.floor((session.expiresAt.getTime() - Date.now()) / 1000) }
    : {};
  void reply.setCookie(REFRESH_COOKIE, session.refreshToken, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    ...lifetime,
  });
  void reply.setCookie(SIGNED_IN_HINT_COOKIE, '1', {
    secure: true,
    sameSite: 'lax',
    path: '/',
    ...lifetime,
  });
}

export function clearRefreshCookie(reply: FastifyReply): void {
  void reply.clearCookie(REFRESH_COOKIE, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
  });
  void reply.clearCookie(SIGNED_IN_HINT_COOKIE, { secure: true, sameSite: 'lax', path: '/' });
}

export function readRefreshCookie(request: FastifyRequest): string | undefined {
  const value = request.cookies[REFRESH_COOKIE];
  return value && value.length <= 128 ? value : undefined;
}

/**
 * CSRF defence for the cookie-authenticated endpoints (ADR-004): a custom header, which a
 * cross-site form or image cannot send without a CORS preflight we never grant, plus an
 * Origin check when the browser sends one.
 */
export function assertSameOrigin(request: FastifyRequest, appBaseUrl: string): void {
  const header = request.headers['x-elega-csrf'];
  const origin = request.headers.origin;
  const site = request.headers['sec-fetch-site'];
  const allowedOrigin = new URL(appBaseUrl).origin;
  if (header !== '1') throw new AppError('forbidden', 'Missing CSRF header');
  if (origin !== undefined && origin !== allowedOrigin)
    throw new AppError('forbidden', 'Origin not allowed');
  if (site !== undefined && site !== 'same-origin' && site !== 'none') {
    throw new AppError('forbidden', 'Cross-site request refused');
  }
}

export function bearerToken(request: FastifyRequest): string | undefined {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) return undefined;
  const token = header.slice('Bearer '.length).trim();
  return token.length > 0 && token.length < 4096 ? token : undefined;
}
