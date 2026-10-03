import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { AppError } from '../../platform/errors/app-error.js';
import {
  emailNotVerified,
  IS_PUBLIC,
  REQUIRES_VERIFIED_EMAIL,
} from '../../platform/request-context.js';
import { AccessTokens } from './access-tokens.js';
import { bearerToken } from './http.js';
import { SessionsService } from './sessions.service.js';

/**
 * Global guard: every route needs a valid bearer access token unless marked `@Public()`.
 * On public routes a valid token is still attached, so handlers can tailor the response; a
 * token that fails is remembered, and `OptionalUser()` turns it into a 401 where the answer
 * depends on the viewer. `@RequireVerifiedEmail()` routes also need the `ev` claim.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: AccessTokens,
    private readonly sessions: SessionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC, targets);
    const needsVerifiedEmail = this.reflector.getAllAndOverride<boolean | undefined>(
      REQUIRES_VERIFIED_EMAIL,
      targets,
    );
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const token = bearerToken(request);
    const user = token ? await this.tokens.verify(token) : null;
    if (user && !(await this.sessions.isDenied(user.sessionId))) {
      request.authUser = user;
      if (needsVerifiedEmail && !user.emailVerified) throw emailNotVerified();
      return true;
    }
    // Any Authorization header that did not authenticate, malformed ones included.
    if (request.headers.authorization !== undefined) request.bearerRejected = true;
    if (isPublic && !needsVerifiedEmail) return true;
    throw new AppError('unauthorized', 'Authentication required');
  }
}
