import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ENV, type Env } from '../../../config/env.js';
import { RateLimit } from '../../../platform/rate-limit.js';
import { Client, type ClientInfo, Public } from '../../../platform/request-context.js';
import {
  type AuthResult,
  type OAuthCompleteBody,
  oauthCompleteSchema,
  providerSchema,
  tokenSchema,
} from '../auth.schemas.js';
import { readRefreshCookie, setRefreshCookie } from '../http.js';
import { OAuthService } from './oauth.service.js';
import type { ProviderName } from './providers.js';

/** Binds the OAuth state to the browser that started the flow (login CSRF defence). */
const STATE_COOKIE = '__Host-elega_oauth';
const STATE_COOKIE_OPTIONS = { httpOnly: true, secure: true, sameSite: 'lax', path: '/' } as const;

const startQuerySchema = z.object({ intent: z.enum(['login', 'link']).default('login') });
const callbackQuerySchema = z.record(z.string(), z.string().max(2048));

@Public()
@Controller('auth/oauth')
export class OAuthController {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly oauth: OAuthService,
  ) {}

  @Get(':provider/start')
  @RateLimit('auth.oauth')
  async start(
    @Param('provider', { schema: providerSchema }) provider: ProviderName,
    @Query({ schema: startQuerySchema }) query: { intent: 'login' | 'link' },
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const started = await this.oauth.start(provider, query.intent, readRefreshCookie(request));
    if ('path' in started) return this.redirect(reply, started.path);
    void reply.setCookie(STATE_COOKIE, started.binding, { ...STATE_COOKIE_OPTIONS, maxAge: 600 });
    void reply.header('cache-control', 'no-store').redirect(started.url, 302);
  }

  @Get(':provider/callback')
  @RateLimit('auth.oauth')
  async callback(
    @Param('provider', { schema: providerSchema }) provider: ProviderName,
    @Query({ schema: callbackQuerySchema }) query: Record<string, string>,
    @Req() request: FastifyRequest,
    @Client() client: ClientInfo,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const outcome = await this.oauth.callback(
      provider,
      query,
      request.cookies[STATE_COOKIE],
      client,
    );
    void reply.clearCookie(STATE_COOKIE, STATE_COOKIE_OPTIONS);
    if (outcome.kind === 'signed_in') {
      setRefreshCookie(reply, outcome.signedIn.session);
      return this.redirect(reply, '/');
    }
    return this.redirect(reply, outcome.path);
  }

  @Post('pending')
  @HttpCode(200)
  @RateLimit('auth.token')
  pending(@Body({ schema: tokenSchema }) body: { token: string }) {
    return this.oauth.pending(body.token);
  }

  @Post('complete')
  @RateLimit('auth.register')
  async complete(
    @Body({ schema: oauthCompleteSchema }) body: OAuthCompleteBody,
    @Client() client: ClientInfo,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<AuthResult> {
    const signedIn = await this.oauth.complete(body, client);
    setRefreshCookie(reply, signedIn.session);
    void reply.header('cache-control', 'no-store');
    return signedIn.result;
  }

  /** Only ever redirects to our own web app (no open redirect). */
  private redirect(reply: FastifyReply, path: string): void {
    void reply.header('cache-control', 'no-store').redirect(`${this.env.APP_BASE_URL}${path}`, 302);
  }
}
