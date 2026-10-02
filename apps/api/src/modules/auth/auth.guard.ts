import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { AppError } from '../../platform/errors/app-error.js';
import { IS_PUBLIC } from '../../platform/request-context.js';
import { AccessTokens } from './access-tokens.js';
import { bearerToken } from './http.js';
import { SessionsService } from './sessions.service.js';

/**
 * Global guard: every route needs a valid bearer access token unless marked `@Public()`.
 * On public routes a valid token is still attached, so handlers can tailor the response.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: AccessTokens,
    private readonly sessions: SessionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const token = bearerToken(request);
    const user = token ? await this.tokens.verify(token) : null;
    if (user && !(await this.sessions.isDenied(user.sessionId))) {
      request.authUser = user;
      return true;
    }
    if (isPublic) return true;
    throw new AppError('unauthorized', 'Authentication required');
  }
}
