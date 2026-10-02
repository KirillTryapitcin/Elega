import { Body, Controller, Get, Patch } from '@nestjs/common';
import { RateLimit } from '../../platform/rate-limit.js';
import { type AuthUser, CurrentUser } from '../../platform/request-context.js';
import { UsersService } from './users.service.js';
import {
  type Me,
  type MeUpdate,
  meUpdateSchema,
  type Settings,
  settingsSchema,
} from './users.types.js';

@Controller('me')
export class MeController {
  constructor(private readonly users: UsersService) {}

  @Get()
  me(@CurrentUser() user: AuthUser): Promise<Me> {
    return this.users.getMe(user.id);
  }

  @Patch()
  @RateLimit('account.write')
  update(
    @CurrentUser() user: AuthUser,
    @Body({ schema: meUpdateSchema }) body: MeUpdate,
  ): Promise<Me> {
    return this.users.updateMe(user.id, body);
  }

  @Get('settings')
  settings(@CurrentUser() user: AuthUser): Promise<Settings> {
    return this.users.getSettings(user.id);
  }

  @Patch('settings')
  @RateLimit('account.write')
  updateSettings(
    @CurrentUser() user: AuthUser,
    @Body({ schema: settingsSchema }) body: Settings,
  ): Promise<Settings> {
    return this.users.updateSettings(user.id, body);
  }
}
