import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ENV, type Env } from '../../config/env.js';
import { RateLimitInterceptor } from '../../platform/rate-limit.js';
import { UsersModule } from '../users/index.js';
import { AccessTokens } from './access-tokens.js';
import { AccountSecurityService } from './account-security.service.js';
import { AccountsService } from './accounts.service.js';
import { AuthController } from './auth.controller.js';
import { AuthGuard } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import { CAPTCHA, NoCaptcha } from './captcha.js';
import { EmailTokens } from './email-tokens.js';
import { Invites } from './invites.js';
import { OAuthController } from './oauth/oauth.controller.js';
import { OAuthService } from './oauth/oauth.service.js';
import {
  createProviders,
  DEFAULT_OAUTH_ENDPOINTS,
  OAUTH_ENDPOINTS,
  OAUTH_PROVIDERS,
  type OAuthEndpoints,
} from './oauth/providers.js';
import { Passwords } from './passwords.js';
import { PublicConfigController } from './public-config.controller.js';
import { SessionsService } from './sessions.service.js';
import { TwoFactorService } from './two-factor.service.js';

@Module({
  imports: [UsersModule],
  controllers: [AuthController, OAuthController, PublicConfigController],
  providers: [
    AccessTokens,
    AccountsService,
    AccountSecurityService,
    AuthService,
    EmailTokens,
    Invites,
    OAuthService,
    Passwords,
    SessionsService,
    TwoFactorService,
    { provide: CAPTCHA, useClass: NoCaptcha },
    { provide: OAUTH_ENDPOINTS, useValue: DEFAULT_OAUTH_ENDPOINTS },
    {
      provide: OAUTH_PROVIDERS,
      inject: [ENV, OAUTH_ENDPOINTS],
      useFactory: (env: Env, endpoints: OAuthEndpoints) => createProviders(env, endpoints),
    },
    // Order matters: authenticate first, then rate-limit (user-keyed rules need the caller).
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_INTERCEPTOR, useClass: RateLimitInterceptor },
  ],
  exports: [Invites, AccessTokens],
})
export class AuthModule {}
