import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { hmac } from './crypto.js';

/**
 * Every route requires a valid access token unless marked `@Public()`. The guard that enforces
 * this lives in the auth module; the marker lives here so platform routes (health) can use it.
 */
export const IS_PUBLIC = 'elega:isPublic';
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** The caller, as established by the access token. */
export interface AuthUser {
  id: string;
  sessionId: string;
  role: 'user' | 'moderator' | 'analyst' | 'admin';
  minor: boolean;
}

declare module 'fastify' {
  interface FastifyRequest {
    authUser?: AuthUser;
  }
}

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const user = ctx.switchToHttp().getRequest<FastifyRequest>().authUser;
  // Only reachable on a public route that forgot to check; fail closed.
  if (!user) throw new Error('CurrentUser used on a route without an authenticated user');
  return user;
});

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
