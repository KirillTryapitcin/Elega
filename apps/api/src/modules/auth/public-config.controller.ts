import { Controller, Get, Inject } from '@nestjs/common';
import type { Schemas } from '@elega/api-client';
import { ENV, type Env } from '../../config/env.js';
import { Public } from '../../platform/request-context.js';
import { AccountsService } from './accounts.service.js';
import { OAuthService } from './oauth/oauth.service.js';

@Public()
@Controller('config')
export class PublicConfigController {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly accounts: AccountsService,
    private readonly oauth: OAuthService,
  ) {}

  @Get('public')
  async publicConfig(): Promise<Schemas['PublicConfig']> {
    return {
      registration: this.env.REGISTRATION_MODE,
      oauthProviders: await this.oauth.enabledProviders(),
      legalVersions: this.accounts.legalVersions,
    };
  }
}
