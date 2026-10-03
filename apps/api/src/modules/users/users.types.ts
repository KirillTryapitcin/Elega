import type { Schemas } from '@elega/api-client';
import { displayNameSchema, usernameSchema } from '@elega/shared';
import { z } from 'zod';

export type Me = Schemas['Me'];
export type Settings = Schemas['Settings'];

const timezoneSchema = z.string().refine((zone) => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}, 'timezone_invalid');

export const meUpdateSchema = z.strictObject({
  displayName: displayNameSchema.optional(),
  username: usernameSchema.optional(),
  locale: z.enum(['ru', 'en']).optional(),
  timezone: timezoneSchema.optional(),
  profile: z.unknown().optional(),
});
export type MeUpdate = z.infer<typeof meUpdateSchema>;

export const settingsSchema = z.strictObject({
  theme: z.enum(['light', 'dark', 'system']).optional(),
  fontScale: z.number().min(1).max(2).optional(),
  feedMode: z.enum(['chronological', 'for_you']).optional(),
  whoCanMessage: z.enum(['everyone', 'friends', 'nobody']).optional(),
  whoCanSendFriendRequests: z.enum(['everyone', 'friends_of_friends', 'nobody']).optional(),
  whoCanSeeOnlineStatus: z.enum(['everyone', 'friends', 'nobody']).optional(),
  whoCanMention: z.enum(['everyone', 'friends', 'nobody']).optional(),
  allowFollowers: z.boolean().optional(),
  readReceiptsEnabled: z.boolean().optional(),
  defaultPostAudience: z.enum(['public', 'friends', 'close_friends', 'only_me']).optional(),
  searchEngineIndexing: z.boolean().optional(),
  discoverableByEmail: z.boolean().optional(),
  dataSaver: z.boolean().optional(),
});
