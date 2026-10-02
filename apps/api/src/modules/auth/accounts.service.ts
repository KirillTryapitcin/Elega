import { Inject, Injectable } from '@nestjs/common';
import { isMinor, MINOR_DEFAULT_SETTINGS, usernameProblem } from '@elega/shared';
import { isDisposableEmailDomain } from 'disposable-email-domains-js';
import { eq, inArray } from 'drizzle-orm';
import {
  authCredentials,
  blockedDomains,
  consents,
  userProfiles,
  userSettings,
  users,
  type AuthProvider,
} from '../../db/schema.js';
import { ENV, type Env } from '../../config/env.js';
import { KEYRING, type Keyring } from '../../platform/crypto.js';
import { DB, type Db, type Executor } from '../../platform/database.js';
import { AppError } from '../../platform/errors/app-error.js';
import { audit, enqueueEmail } from '../../platform/outbox.js';
import { type AuthUser, type ClientInfo, hashIp } from '../../platform/request-context.js';
import { deviceName } from '../../platform/user-agent.js';
import { UsersService } from '../users/index.js';
import { ACCESS_TOKEN_TTL_SEC, AccessTokens } from './access-tokens.js';
import type { AuthResult } from './auth.schemas.js';
import { EmailTokens } from './email-tokens.js';
import { Invites } from './invites.js';
import { type IssuedSession, SessionsService } from './sessions.service.js';

export interface NewAccount {
  email: string;
  emailVerified: boolean;
  passwordHash: string | null;
  displayName: string;
  username: string;
  birthdate: string;
  locale: 'ru' | 'en';
  inviteCode?: string | undefined;
  acceptedTermsVersion: string;
  acceptedPrivacyVersion: string;
  acceptedPdProcessingVersion: string;
  external?: { provider: Exclude<AuthProvider, 'password'>; providerUserId: string };
}

const field = (name: string, message: string) => ({ field: name, message });

/** Creates accounts and turns sessions into AuthResults; shared by every sign-in path. */
@Injectable()
export class AccountsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
    @Inject(KEYRING) private readonly keyring: Keyring,
    private readonly users: UsersService,
    private readonly sessions: SessionsService,
    private readonly tokens: AccessTokens,
    private readonly invites: Invites,
    private readonly emailTokens: EmailTokens,
  ) {}

  get legalVersions() {
    return {
      terms: this.env.LEGAL_TERMS_VERSION,
      privacy: this.env.LEGAL_PRIVACY_VERSION,
      pdProcessing: this.env.LEGAL_PD_PROCESSING_VERSION,
    };
  }

  /** Rejects disposable domains (brief §8.1) and domains blocked by moderators. */
  async assertEmailAllowed(
    email: string,
    fieldName = 'email',
    db: Executor = this.db,
  ): Promise<void> {
    const domain = email.slice(email.lastIndexOf('@') + 1).toLowerCase();
    const parents = domain.split('.').map((_, index, parts) => parts.slice(index).join('.'));
    const blocked =
      parents.some((candidate) => isDisposableEmailDomain(candidate)) ||
      (
        await db
          .select({ domain: blockedDomains.domain })
          .from(blockedDomains)
          .where(inArray(blockedDomains.domain, parents))
      ).length > 0;
    if (blocked) {
      throw new AppError('validation_failed', 'Validation failed', [
        field(fieldName, 'email_domain_not_allowed'),
      ]);
    }
  }

  async create(
    input: NewAccount,
    client: ClientInfo,
  ): Promise<{ user: AuthUser; session: IssuedSession; result: AuthResult }> {
    const legal = this.legalVersions;
    const outdated = [
      input.acceptedTermsVersion !== legal.terms &&
        field('acceptedTermsVersion', 'version_outdated'),
      input.acceptedPrivacyVersion !== legal.privacy &&
        field('acceptedPrivacyVersion', 'version_outdated'),
      input.acceptedPdProcessingVersion !== legal.pdProcessing &&
        field('acceptedPdProcessingVersion', 'version_outdated'),
    ].filter((detail) => detail !== false);
    if (outdated.length > 0) throw new AppError('validation_failed', 'Validation failed', outdated);
    if (this.env.REGISTRATION_MODE === 'closed') {
      throw new AppError('registration_closed', 'Registration is closed');
    }
    const problem = usernameProblem(input.username);
    if (problem) {
      throw new AppError('validation_failed', 'Validation failed', [
        field('username', `username_${problem}`),
      ]);
    }
    await this.assertEmailAllowed(input.email);
    const ipHash = hashIp(this.keyring.pii, client.ip);

    try {
      return await this.db.transaction(async (tx) => {
        let inviteId: string | null = null;
        if (this.env.REGISTRATION_MODE === 'invite_only') {
          inviteId = input.inviteCode ? await this.invites.redeem(tx, input.inviteCode) : null;
          if (!inviteId) {
            throw new AppError('validation_failed', 'Validation failed', [
              field('inviteCode', 'invite_invalid'),
            ]);
          }
        }
        const [emailTaken] = await tx
          .select({ id: users.id })
          .from(users)
          .where(eq(users.email, input.email));
        if (emailTaken) {
          throw new AppError('conflict', 'An account with this email already exists', [
            field('email', 'email_taken'),
          ]);
        }
        if (!(await this.users.isUsernameAvailable(input.username, tx))) {
          throw new AppError('conflict', 'Username is taken', [
            field('username', 'username_taken'),
          ]);
        }
        const [created] = await tx
          .insert(users)
          .values({
            email: input.email,
            emailVerifiedAt: input.emailVerified ? new Date() : null,
            passwordHash: input.passwordHash,
            username: input.username,
            displayName: input.displayName,
            locale: input.locale,
            birthdate: input.birthdate,
            invitedByCodeId: inviteId,
          })
          .returning({ id: users.id, role: users.role });
        if (!created) throw new Error('user insert returned nothing');
        const minor = isMinor(input.birthdate);
        await tx.insert(userProfiles).values({ userId: created.id });
        // Brief §21.3: under-18 accounts start private and are not discoverable.
        await tx
          .insert(userSettings)
          .values({ userId: created.id, ...(minor ? MINOR_DEFAULT_SETTINGS : {}) });
        await tx.insert(consents).values([
          { userId: created.id, type: 'terms', version: input.acceptedTermsVersion, ipHash },
          { userId: created.id, type: 'privacy', version: input.acceptedPrivacyVersion, ipHash },
          {
            userId: created.id,
            type: 'pd_processing',
            version: input.acceptedPdProcessingVersion,
            ipHash,
          },
        ]);
        if (input.external) {
          await tx.insert(authCredentials).values({ userId: created.id, ...input.external });
        }
        if (!input.emailVerified) {
          const token = await this.emailTokens.issue(tx, created.id, 'verify_email');
          await enqueueEmail(tx, created.id, {
            template: 'verify_email',
            to: input.email,
            locale: input.locale,
            linkPath: `/verify-email#token=${token}`,
            params: { name: input.displayName },
          });
        }
        await audit(tx, {
          actorId: created.id,
          action: 'user.registered',
          entityType: 'user',
          entityId: created.id,
          after: { via: input.external?.provider ?? 'password', minor, invited: inviteId !== null },
          ipHash,
          userAgent: client.userAgent,
        });
        const session = await this.sessions.create(tx, created.id, false, client);
        const user: AuthUser = {
          id: created.id,
          sessionId: session.sessionId,
          role: created.role,
          minor,
        };
        return { user, session, result: await this.authResult(user, tx) };
      });
    } catch (error) {
      // Two sign-ups racing for the same email or username: the unique index decides.
      if ((error as { code?: string }).code === '23505') {
        throw new AppError('conflict', 'Email or username already taken');
      }
      throw error;
    }
  }

  /** Signs in an existing account: new session, new-device notice, access token. */
  async signIn(
    db: Executor,
    account: {
      id: string;
      role: AuthUser['role'];
      birthdate: string;
      email: string;
      locale: 'ru' | 'en';
    },
    remember: boolean,
    client: ClientInfo,
  ): Promise<{ session: IssuedSession; result: AuthResult }> {
    const session = await this.sessions.create(db, account.id, remember, client);
    if (session.newDevice) {
      await enqueueEmail(db, account.id, {
        template: 'new_device_login',
        to: account.email,
        locale: account.locale,
        linkPath: '/settings/security',
        params: { device: deviceName(client.userAgent), time: new Date().toISOString() },
      });
    }
    const user: AuthUser = {
      id: account.id,
      sessionId: session.sessionId,
      role: account.role,
      minor: isMinor(account.birthdate),
    };
    await audit(db, {
      actorId: account.id,
      action: 'session.created',
      entityType: 'session',
      entityId: session.sessionId,
      after: { remember, newDevice: session.newDevice },
      ipHash: hashIp(this.keyring.pii, client.ip),
      userAgent: client.userAgent,
    });
    return { session, result: await this.authResult(user, db) };
  }

  async authResult(user: AuthUser, db: Executor = this.db): Promise<AuthResult> {
    return {
      accessToken: await this.tokens.sign(user),
      expiresIn: ACCESS_TOKEN_TTL_SEC,
      user: await this.users.getMe(user.id, db),
    };
  }
}
