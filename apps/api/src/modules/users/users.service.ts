import { Inject, Injectable } from '@nestjs/common';
import { isMinor, minorSettingViolations, usernameProblem } from '@elega/shared';
import { and, desc, eq, gt, isNotNull, ne } from 'drizzle-orm';
import { DB, type Db, type Executor } from '../../platform/database.js';
import { AppError } from '../../platform/errors/app-error.js';
import {
  totpSecrets,
  userProfiles,
  userSettings,
  usernameHistory,
  users,
} from '../../db/schema.js';
import type { Me, MeUpdate, Settings } from './users.types.js';

const USERNAME_CHANGE_COOLDOWN_DAYS = 14;
const USERNAME_REDIRECT_DAYS = 30;
const DAY_MS = 86_400_000;

type UserRow = typeof users.$inferSelect;
type SettingsRow = typeof userSettings.$inferSelect;

@Injectable()
export class UsersService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async findById(id: string, db: Executor = this.db): Promise<UserRow | undefined> {
    const [row] = await db.select().from(users).where(eq(users.id, id));
    return row;
  }

  async getMe(userId: string, db: Executor = this.db): Promise<Me> {
    const [row] = await db
      .select({ user: users, profile: userProfiles, totpConfirmedAt: totpSecrets.confirmedAt })
      .from(users)
      .leftJoin(userProfiles, eq(userProfiles.userId, users.id))
      .leftJoin(totpSecrets, eq(totpSecrets.userId, users.id))
      .where(eq(users.id, userId));
    if (!row) throw new AppError('unauthorized', 'Authentication required');
    const { user, profile } = row;
    return {
      id: user.id,
      email: user.email,
      emailVerified: user.emailVerifiedAt !== null,
      username: user.username,
      displayName: user.displayName,
      role: user.role,
      isMinor: isMinor(user.birthdate),
      locale: user.locale,
      timezone: user.timezone,
      twoFactorEnabled: row.totpConfirmedAt !== null,
      hasPassword: user.passwordHash !== null,
      profile: {
        bio: profile?.bio ?? null,
        city: profile?.city ?? null,
        workplace: profile?.workplace ?? null,
        education: profile?.education ?? null,
        website: profile?.website ?? null,
        birthday: user.birthdate,
        pronouns: profile?.pronouns ?? null,
        relationshipStatus: profile?.relationshipStatus ?? null,
        links: profile?.linksJson ?? [],
        avatar: null,
        cover: null,
        fieldAudience: (profile?.profileVisibilityJson ?? {}) as NonNullable<
          Me['profile']
        >['fieldAudience'],
      },
    };
  }

  /** Account fields. Profile fields and per-field privacy arrive with M2 (profiles). */
  async updateMe(userId: string, patch: MeUpdate): Promise<Me> {
    if (patch.profile !== undefined) {
      throw new AppError('validation_failed', 'Validation failed', [
        { field: 'profile', message: 'profile_editing_not_available' },
      ]);
    }
    await this.db.transaction(async (tx) => {
      const user = await this.findById(userId, tx);
      if (!user) throw new AppError('unauthorized', 'Authentication required');
      if (patch.username !== undefined && patch.username !== user.username) {
        await this.changeUsername(tx, user, patch.username);
      }
      const fields: Partial<typeof users.$inferInsert> = {};
      if (patch.displayName !== undefined) fields.displayName = patch.displayName;
      if (patch.locale !== undefined) fields.locale = patch.locale;
      if (patch.timezone !== undefined) fields.timezone = patch.timezone;
      if (Object.keys(fields).length > 0) {
        await tx.update(users).set(fields).where(eq(users.id, userId));
      }
    });
    return this.getMe(userId);
  }

  async isUsernameAvailable(username: string, db: Executor = this.db, exceptUserId?: string) {
    const taken = await db
      .select({ id: users.id })
      .from(users)
      .where(
        exceptUserId
          ? and(eq(users.username, username), ne(users.id, exceptUserId))
          : eq(users.username, username),
      );
    if (taken.length > 0) return false;
    const held = await db
      .select({ userId: usernameHistory.userId })
      .from(usernameHistory)
      .where(
        and(eq(usernameHistory.username, username), gt(usernameHistory.redirectUntil, new Date())),
      );
    return held.every((row) => row.userId === exceptUserId);
  }

  private async changeUsername(tx: Executor, user: UserRow, username: string): Promise<void> {
    const problem = usernameProblem(username);
    if (problem) {
      throw new AppError('validation_failed', 'Validation failed', [
        { field: 'username', message: `username_${problem}` },
      ]);
    }
    const [last] = await tx
      .select({ releasedAt: usernameHistory.releasedAt })
      .from(usernameHistory)
      .where(and(eq(usernameHistory.userId, user.id), isNotNull(usernameHistory.releasedAt)))
      .orderBy(desc(usernameHistory.releasedAt))
      .limit(1);
    const since = last ? Date.now() - last.releasedAt.getTime() : Infinity;
    if (since < USERNAME_CHANGE_COOLDOWN_DAYS * DAY_MS) {
      throw new AppError('conflict', 'Username can be changed once every 14 days', [
        { field: 'username', message: 'username_cooldown' },
      ]);
    }
    if (!(await this.isUsernameAvailable(username, tx, user.id))) {
      throw new AppError('conflict', 'Username is taken', [
        { field: 'username', message: 'username_taken' },
      ]);
    }
    // Free our own old reservation of the new name, then reserve the old name for redirects.
    await tx.delete(usernameHistory).where(eq(usernameHistory.username, username));
    await tx
      .insert(usernameHistory)
      .values({
        username: user.username,
        userId: user.id,
        releasedAt: new Date(),
        redirectUntil: new Date(Date.now() + USERNAME_REDIRECT_DAYS * DAY_MS),
      })
      .onConflictDoUpdate({
        target: usernameHistory.username,
        set: {
          userId: user.id,
          releasedAt: new Date(),
          redirectUntil: new Date(Date.now() + USERNAME_REDIRECT_DAYS * DAY_MS),
        },
      });
    await tx.update(users).set({ username }).where(eq(users.id, user.id));
  }

  async getSettings(userId: string): Promise<Settings> {
    const [row] = await this.db.select().from(userSettings).where(eq(userSettings.userId, userId));
    if (!row) throw new AppError('not_found', 'Not found');
    return toSettings(row);
  }

  async updateSettings(userId: string, patch: Settings): Promise<Settings> {
    const user = await this.findById(userId);
    if (!user) throw new AppError('unauthorized', 'Authentication required');
    if (isMinor(user.birthdate)) {
      const violations = minorSettingViolations(patch);
      if (violations.length > 0) {
        throw new AppError(
          'forbidden',
          'Not available for accounts under 18',
          violations.map((field) => ({ field, message: 'not_allowed_for_minors' })),
        );
      }
    }
    if (Object.keys(patch).length > 0) {
      await this.db.update(userSettings).set(patch).where(eq(userSettings.userId, userId));
    }
    return this.getSettings(userId);
  }
}

function toSettings(row: SettingsRow): Settings {
  return {
    theme: row.theme,
    fontScale: Number(row.fontScale),
    feedMode: row.feedMode,
    whoCanMessage: row.whoCanMessage,
    whoCanSendFriendRequests: row.whoCanSendFriendRequests,
    whoCanSeeOnlineStatus: row.whoCanSeeOnlineStatus,
    whoCanMention: row.whoCanMention,
    allowFollowers: row.allowFollowers,
    readReceiptsEnabled: row.readReceiptsEnabled,
    defaultPostAudience: row.defaultPostAudience,
    searchEngineIndexing: row.searchEngineIndexing,
    discoverableByEmail: row.discoverableByEmail,
    dataSaver: row.dataSaver,
  };
}
