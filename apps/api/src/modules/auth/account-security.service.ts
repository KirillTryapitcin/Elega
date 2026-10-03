import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull, ne } from 'drizzle-orm';
import { authCredentials, users } from '../../db/schema.js';
import { hmac, KEYRING, type Keyring } from '../../platform/crypto.js';
import { DB, type Db, type Executor } from '../../platform/database.js';
import { AppError } from '../../platform/errors/app-error.js';
import { audit, enqueueEmail } from '../../platform/outbox.js';
import { RateLimiter } from '../../platform/rate-limit.js';
import { type AuthUser, type ClientInfo, hashIp } from '../../platform/request-context.js';
import { AccountsService } from './accounts.service.js';
import type { PasswordConfirm } from './auth.schemas.js';
import { AuthService } from './auth.service.js';
import { EmailTokens } from './email-tokens.js';
import { Passwords } from './passwords.js';
import { SessionsService } from './sessions.service.js';
import { TwoFactorService } from './two-factor.service.js';

const invalidToken = () =>
  new AppError('validation_failed', 'This link is invalid or has expired', [
    { field: 'token', message: 'token_invalid' },
  ]);

/** Email verification, password reset and change, email change, 2FA toggles (brief §8.5–8.7). */
@Injectable()
export class AccountSecurityService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(KEYRING) private readonly keyring: Keyring,
    private readonly accounts: AccountsService,
    private readonly auth: AuthService,
    private readonly emailTokens: EmailTokens,
    private readonly passwords: Passwords,
    private readonly sessions: SessionsService,
    private readonly twoFactor: TwoFactorService,
    private readonly limiter: RateLimiter,
  ) {}

  async verifyEmail(token: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const row = await this.emailTokens.consume(tx, token, ['verify_email', 'change_email']);
      if (!row) throw invalidToken();
      if (row.type === 'verify_email') {
        await tx
          .update(users)
          .set({ emailVerifiedAt: new Date() })
          .where(and(eq(users.id, row.userId), isNull(users.emailVerifiedAt)));
        await audit(tx, {
          actorId: row.userId,
          action: 'user.email_verified',
          entityType: 'user',
          entityId: row.userId,
        });
        return;
      }
      const newEmail = row.newEmail!;
      const [taken] = await tx
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.email, newEmail), ne(users.id, row.userId)));
      if (taken) {
        throw new AppError('conflict', 'An account with this email already exists', [
          { field: 'email', message: 'email_taken' },
        ]);
      }
      await tx
        .update(users)
        .set({ email: newEmail, emailVerifiedAt: new Date() })
        .where(eq(users.id, row.userId));
      // Any verification link still pointing at the old address is now meaningless.
      await this.emailTokens.invalidate(tx, row.userId, 'verify_email');
      await audit(tx, {
        actorId: row.userId,
        action: 'user.email_changed',
        entityType: 'user',
        entityId: row.userId,
      });
    });
  }

  async resendVerification(user: AuthUser): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [row] = await tx.select().from(users).where(eq(users.id, user.id));
      if (!row || row.emailVerifiedAt) return;
      const token = await this.emailTokens.issue(tx, row.id, 'verify_email');
      await enqueueEmail(tx, row.id, {
        template: 'verify_email',
        to: row.email,
        locale: row.locale,
        linkPath: `/verify-email#token=${token}`,
        params: { name: row.displayName },
      });
    });
  }

  /** Always 202 with the same body, whether or not the account exists (brief §8.5). */
  async forgotPassword(email: string): Promise<void> {
    const subject = hmac(this.keyring.pii, `forgot:${email}`).toString('hex');
    const allowed = await this.limiter.consume('auth.forgot.email', subject);
    if (!allowed.allowed) return; // silently dropped: a 429 here would confirm the address
    await this.db.transaction(async (tx) => {
      const [row] = await tx.select().from(users).where(eq(users.email, email));
      if (!row || row.status === 'banned') return;
      const token = await this.emailTokens.issue(tx, row.id, 'reset_password');
      await enqueueEmail(tx, row.id, {
        template: 'reset_password',
        to: row.email,
        locale: row.locale,
        linkPath: `/reset-password#token=${token}`,
        params: { name: row.displayName },
      });
    });
  }

  /** Brief §8.5: on reset, revoke all sessions and notify by email. */
  async resetPassword(token: string, newPassword: string, client: ClientInfo): Promise<void> {
    const identifiers = await this.db.transaction(async (tx) => {
      const row = await this.emailTokens.consume(tx, token, ['reset_password']);
      if (!row) throw invalidToken();
      const [user] = await tx.select().from(users).where(eq(users.id, row.userId));
      if (!user) throw invalidToken();
      this.passwords.assertAcceptable(
        newPassword,
        [user.email, user.username, user.displayName],
        'newPassword',
      );
      // Following a reset link proves control of the mailbox, which also verifies it.
      await tx
        .update(users)
        .set({
          passwordHash: await this.passwords.hash(newPassword),
          emailVerifiedAt: user.emailVerifiedAt ?? new Date(),
        })
        .where(eq(users.id, user.id));
      await this.sessions.revokeAllForUser(tx, user.id);
      await this.notify(tx, user, 'password_changed');
      await this.record(tx, user.id, 'user.password_reset', client);
      return [user.email, user.username];
    });
    // A successful reset lifts the short login lockout for the account.
    for (const identifier of identifiers) {
      await this.limiter.reset(
        'auth.login.failures',
        hmac(this.keyring.pii, `login:${identifier.toLowerCase()}`).toString('hex'),
      );
    }
  }

  async changePassword(
    user: AuthUser,
    currentPassword: string,
    newPassword: string,
    client: ClientInfo,
  ): Promise<void> {
    const [row] = await this.db.select().from(users).where(eq(users.id, user.id));
    if (!row) throw new AppError('unauthorized', 'Authentication required');
    if (!row.passwordHash || !(await this.passwords.verify(row.passwordHash, currentPassword))) {
      throw new AppError('reauth_required', 'Confirm it is you', [
        { field: 'currentPassword', message: 'password_invalid' },
      ]);
    }
    this.passwords.assertAcceptable(
      newPassword,
      [row.email, row.username, row.displayName],
      'newPassword',
    );
    const family = await this.sessions.familyOf(user.sessionId);
    await this.db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({ passwordHash: await this.passwords.hash(newPassword) })
        .where(eq(users.id, user.id));
      // ADR-004: other devices are signed out; this one stays.
      await this.sessions.revokeAllForUser(tx, user.id, family?.familyId);
      await this.notify(tx, row, 'password_changed');
      await this.record(tx, user.id, 'user.password_changed', client);
    });
  }

  /** Brief §8.6: current password required; confirm to the new address, notice to the old. */
  async changeEmail(
    user: AuthUser,
    currentPassword: string,
    newEmail: string,
    client: ClientInfo,
  ): Promise<void> {
    const [row] = await this.db.select().from(users).where(eq(users.id, user.id));
    if (!row) throw new AppError('unauthorized', 'Authentication required');
    if (!row.passwordHash || !(await this.passwords.verify(row.passwordHash, currentPassword))) {
      throw new AppError('reauth_required', 'Confirm it is you', [
        { field: 'currentPassword', message: 'password_invalid' },
      ]);
    }
    if (newEmail === row.email) {
      throw new AppError('validation_failed', 'Validation failed', [
        { field: 'newEmail', message: 'email_unchanged' },
      ]);
    }
    await this.accounts.assertEmailAllowed(newEmail, 'newEmail');
    const [taken] = await this.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, newEmail));
    if (taken) {
      throw new AppError('conflict', 'An account with this email already exists', [
        { field: 'newEmail', message: 'email_taken' },
      ]);
    }
    await this.db.transaction(async (tx) => {
      const token = await this.emailTokens.issue(tx, row.id, 'change_email', newEmail);
      await enqueueEmail(tx, row.id, {
        template: 'change_email_confirm',
        to: newEmail,
        locale: row.locale,
        linkPath: `/verify-email#token=${token}`,
        params: { name: row.displayName },
      });
      await enqueueEmail(tx, row.id, {
        template: 'change_email_notice',
        to: row.email,
        locale: row.locale,
        linkPath: '/settings/security',
        params: { name: row.displayName },
      });
      await this.record(tx, row.id, 'user.email_change_requested', client);
    });
  }

  async setupTwoFactor(user: AuthUser, confirm: PasswordConfirm) {
    const row = await this.auth.reauthenticate(user, confirm);
    return this.twoFactor.setup(user.id, row.email);
  }

  async confirmTwoFactor(user: AuthUser, code: string, client: ClientInfo): Promise<string[]> {
    const codes = await this.twoFactor.confirm(user.id, code);
    const family = await this.sessions.familyOf(user.sessionId);
    await this.db.transaction(async (tx) => {
      const [row] = await tx.select().from(users).where(eq(users.id, user.id));
      await this.sessions.revokeAllForUser(tx, user.id, family?.familyId);
      if (row) await this.notify(tx, row, 'two_factor_enabled');
      await this.record(tx, user.id, 'user.2fa_enabled', client);
    });
    return codes;
  }

  async disableTwoFactor(
    user: AuthUser,
    confirm: PasswordConfirm,
    client: ClientInfo,
  ): Promise<void> {
    if (user.role !== 'user') {
      throw new AppError('forbidden', 'Staff accounts must keep two-factor authentication on');
    }
    if (!(await this.twoFactor.isEnabled(user.id))) return;
    const row = await this.auth.reauthenticate(user, confirm);
    const family = await this.sessions.familyOf(user.sessionId);
    await this.db.transaction(async (tx) => {
      await this.twoFactor.disable(tx, user.id);
      await this.sessions.revokeAllForUser(tx, user.id, family?.familyId);
      await this.notify(tx, row, 'two_factor_disabled');
      await this.record(tx, user.id, 'user.2fa_disabled', client);
    });
  }

  /** Providers linked to the account. */
  async linkedProviders(userId: string) {
    const rows = await this.db
      .select({ provider: authCredentials.provider, createdAt: authCredentials.createdAt })
      .from(authCredentials)
      .where(eq(authCredentials.userId, userId));
    return rows
      .filter((row) => row.provider !== 'password')
      .map((row) => ({
        provider: row.provider as 'vk' | 'yandex' | 'google',
        linkedAt: row.createdAt.toISOString(),
      }));
  }

  /** Refuses to remove the last way to sign in. */
  async unlinkProvider(
    user: AuthUser,
    provider: 'vk' | 'yandex' | 'google',
    client: ClientInfo,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [row] = await tx.select().from(users).where(eq(users.id, user.id)).for('update');
      if (!row) throw new AppError('unauthorized', 'Authentication required');
      const linked = await tx
        .select({ provider: authCredentials.provider })
        .from(authCredentials)
        .where(eq(authCredentials.userId, user.id));
      if (!linked.some((credential) => credential.provider === provider)) {
        throw new AppError('not_found', 'Not found');
      }
      const remaining = linked.filter((credential) => credential.provider !== provider).length;
      if (!row.passwordHash && remaining === 0) {
        throw new AppError('conflict', 'Set a password before unlinking your only sign-in method');
      }
      await tx
        .delete(authCredentials)
        .where(and(eq(authCredentials.userId, user.id), eq(authCredentials.provider, provider)));
      await this.record(tx, user.id, `user.provider_unlinked.${provider}`, client);
    });
  }

  private async notify(
    db: Executor,
    user: typeof users.$inferSelect,
    template: 'password_changed' | 'two_factor_enabled' | 'two_factor_disabled',
  ): Promise<void> {
    await enqueueEmail(db, user.id, {
      template,
      to: user.email,
      locale: user.locale,
      linkPath: '/settings/security',
      params: { name: user.displayName },
    });
  }

  private record(db: Executor, userId: string, action: string, client: ClientInfo): Promise<void> {
    return audit(db, {
      actorId: userId,
      action,
      entityType: 'user',
      entityId: userId,
      ipHash: hashIp(this.keyring.pii, client.ip),
      userAgent: client.userAgent,
    });
  }
}
