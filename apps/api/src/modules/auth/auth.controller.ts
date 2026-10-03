import {
  Body,
  Controller,
  Delete,
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
import { ENV, type Env } from '../../config/env.js';
import { AppError } from '../../platform/errors/app-error.js';
import { RateLimit } from '../../platform/rate-limit.js';
import {
  type AuthUser,
  Client,
  type ClientInfo,
  CurrentUser,
  Public,
} from '../../platform/request-context.js';
import { AccountSecurityService } from './account-security.service.js';
import {
  type AuthResult,
  changeEmailSchema,
  changePasswordSchema,
  emailSchema,
  type LoginBody,
  loginSchema,
  type MfaChallenge,
  mfaLoginSchema,
  pageQuerySchema,
  type PasswordConfirm,
  passwordConfirmSchema,
  providerSchema,
  type RegisterBody,
  registerSchema,
  resetPasswordSchema,
  tokenSchema,
  totpConfirmSchema,
  uuidParamSchema,
} from './auth.schemas.js';
import { AuthService, type SignedIn } from './auth.service.js';
import {
  assertSameOrigin,
  clearRefreshCookie,
  readRefreshCookie,
  setRefreshCookie,
} from './http.js';
import { SessionsService } from './sessions.service.js';

@Controller('auth')
export class AuthController {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly auth: AuthService,
    private readonly security: AccountSecurityService,
    private readonly sessions: SessionsService,
  ) {}

  @Public()
  @Post('register')
  @RateLimit('auth.register')
  async register(
    @Body({ schema: registerSchema }) body: RegisterBody,
    @Client() client: ClientInfo,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<AuthResult> {
    return this.deliver(reply, await this.auth.register(body, client));
  }

  @Public()
  @Post('verify-email')
  @HttpCode(200)
  @RateLimit('auth.token')
  async verifyEmail(@Body({ schema: tokenSchema }) body: { token: string }): Promise<{ ok: true }> {
    await this.security.verifyEmail(body.token);
    return { ok: true };
  }

  @Post('resend-verification')
  @HttpCode(202)
  @RateLimit('auth.resend')
  async resendVerification(@CurrentUser() user: AuthUser): Promise<{ ok: true }> {
    await this.security.resendVerification(user);
    return { ok: true };
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  @RateLimit('auth.login')
  async login(
    @Body({ schema: loginSchema }) body: LoginBody,
    @Client() client: ClientInfo,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<AuthResult | MfaChallenge> {
    const outcome = await this.auth.login(body, client);
    return 'mfaRequired' in outcome ? outcome : this.deliver(reply, outcome);
  }

  @Public()
  @Post('login/2fa')
  @HttpCode(200)
  @RateLimit('auth.mfa')
  async loginWithMfa(
    @Body({ schema: mfaLoginSchema }) body: { mfaToken: string; code: string },
    @Client() client: ClientInfo,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<AuthResult> {
    return this.deliver(reply, await this.auth.loginWithMfa(body.mfaToken, body.code, client));
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  @RateLimit('auth.refresh')
  async refresh(
    @Req() request: FastifyRequest,
    @Client() client: ClientInfo,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<AuthResult> {
    assertSameOrigin(request, this.env.APP_BASE_URL);
    const token = readRefreshCookie(request);
    if (!token) throw new AppError('unauthorized', 'Session expired');
    try {
      return this.deliver(reply, await this.auth.refresh(token, client));
    } catch (error) {
      clearRefreshCookie(reply);
      throw error;
    }
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  @RateLimit('auth.refresh')
  async logout(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    assertSameOrigin(request, this.env.APP_BASE_URL);
    await this.auth.logout(readRefreshCookie(request));
    clearRefreshCookie(reply);
  }

  @Post('logout-all')
  @HttpCode(204)
  @RateLimit('auth.sensitive')
  async logoutAll(
    @CurrentUser() user: AuthUser,
    @Body({ schema: passwordConfirmSchema }) body: PasswordConfirm,
    @Client() client: ClientInfo,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    await this.auth.logoutAll(user, body, client);
    clearRefreshCookie(reply);
  }

  @Public()
  @Post('forgot-password')
  @HttpCode(202)
  @RateLimit('auth.forgot')
  async forgotPassword(@Body({ schema: emailSchema }) body: { email: string }): Promise<void> {
    await this.security.forgotPassword(body.email);
  }

  @Public()
  @Post('reset-password')
  @HttpCode(204)
  @RateLimit('auth.token')
  async resetPassword(
    @Body({ schema: resetPasswordSchema }) body: { token: string; newPassword: string },
    @Client() client: ClientInfo,
  ): Promise<void> {
    await this.security.resetPassword(body.token, body.newPassword, client);
  }

  @Post('change-password')
  @HttpCode(204)
  @RateLimit('auth.sensitive')
  async changePassword(
    @CurrentUser() user: AuthUser,
    @Body({ schema: changePasswordSchema }) body: { currentPassword: string; newPassword: string },
    @Client() client: ClientInfo,
  ): Promise<void> {
    await this.security.changePassword(user, body.currentPassword, body.newPassword, client);
  }

  @Post('change-email')
  @HttpCode(202)
  @RateLimit('auth.sensitive')
  async changeEmail(
    @CurrentUser() user: AuthUser,
    @Body({ schema: changeEmailSchema }) body: { currentPassword: string; newEmail: string },
    @Client() client: ClientInfo,
  ): Promise<void> {
    await this.security.changeEmail(user, body.currentPassword, body.newEmail, client);
  }

  @Post('2fa/setup')
  @HttpCode(200)
  @RateLimit('auth.sensitive')
  setupTwoFactor(
    @CurrentUser() user: AuthUser,
    @Body({ schema: passwordConfirmSchema }) body: PasswordConfirm,
  ): Promise<{ otpauthUrl: string; qrSvg: string }> {
    return this.security.setupTwoFactor(user, body);
  }

  @Post('2fa/confirm')
  @HttpCode(200)
  @RateLimit('auth.sensitive')
  async confirmTwoFactor(
    @CurrentUser() user: AuthUser,
    @Body({ schema: totpConfirmSchema }) body: { code: string },
    @Client() client: ClientInfo,
  ): Promise<{ recoveryCodes: string[] }> {
    return { recoveryCodes: await this.security.confirmTwoFactor(user, body.code, client) };
  }

  @Post('2fa/disable')
  @HttpCode(204)
  @RateLimit('auth.sensitive')
  async disableTwoFactor(
    @CurrentUser() user: AuthUser,
    @Body({ schema: passwordConfirmSchema }) body: PasswordConfirm,
    @Client() client: ClientInfo,
  ): Promise<void> {
    await this.security.disableTwoFactor(user, body, client);
  }

  @Get('sessions')
  listSessions(
    @CurrentUser() user: AuthUser,
    @Query({ schema: pageQuerySchema }) query: { limit: number; cursor?: string },
  ) {
    return this.sessions.list(user.id, user.sessionId, query.limit, query.cursor);
  }

  @Delete('sessions/:id')
  @HttpCode(204)
  @RateLimit('account.write')
  async revokeSession(
    @CurrentUser() user: AuthUser,
    @Param('id', { schema: uuidParamSchema }) id: string,
  ): Promise<void> {
    if (!(await this.sessions.revokeForUser(user.id, id)))
      throw new AppError('not_found', 'Not found');
  }

  @Get('providers')
  async providers(@CurrentUser() user: AuthUser) {
    return { data: await this.security.linkedProviders(user.id) };
  }

  @Delete('providers/:provider')
  @HttpCode(204)
  @RateLimit('auth.sensitive')
  async unlinkProvider(
    @CurrentUser() user: AuthUser,
    @Param('provider', { schema: providerSchema }) provider: 'vk' | 'yandex' | 'google',
    @Client() client: ClientInfo,
  ): Promise<void> {
    await this.security.unlinkProvider(user, provider, client);
  }

  private deliver(reply: FastifyReply, signedIn: SignedIn): AuthResult {
    setRefreshCookie(reply, signedIn.session);
    void reply.header('cache-control', 'no-store');
    return signedIn.result;
  }
}
