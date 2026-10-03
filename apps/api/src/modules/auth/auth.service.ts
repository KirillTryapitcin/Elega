import { Inject, Injectable } from '@nestjs/common';
import { isMinor } from '@elega/shared';
import { eq, or } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import { loginAttempts, users } from '../../db/schema.js';
import { CAPTCHA, type CaptchaVerifier } from './captcha.js';
import { hmac, KEYRING, type Keyring, randomToken, sha256 } from '../../platform/crypto.js';
import { DB, type Db } from '../../platform/database.js';
import { AppError } from '../../platform/errors/app-error.js';
import { audit } from '../../platform/outbox.js';
import { RateLimiter, rateLimited } from '../../platform/rate-limit.js';
import { REDIS } from '../../platform/redis.js';
import { type AuthUser, type ClientInfo, hashIp } from '../../platform/request-context.js';
import { AccountsService } from './accounts.service.js';
import type {
  AuthResult,
  LoginBody,
  MfaChallenge,
  PasswordConfirm,
  RegisterBody,
} from './auth.schemas.js';
import { Passwords } from './passwords.js';
import { type IssuedSession, SessionsService } from './sessions.service.js';
import { TwoFactorService } from './two-factor.service.js';

const MFA_CHALLENGE_TTL_SEC = 300;
const MFA_MAX_ATTEMPTS = 5;
/** Accounts without a password re-authenticate by having signed in this recently. */
const RECENT_SIGN_IN_MS = 10 * 60 * 1000;
const INVALID_CREDENTIALS = 'Invalid email or password';

type UserRow = typeof users.$inferSelect;

export interface SignedIn {
  result: AuthResult;
  session: IssuedSession;
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(KEYRING) private readonly keyring: Keyring,
    @Inject(CAPTCHA) private readonly captcha: CaptchaVerifier,
    private readonly accounts: AccountsService,
    private readonly passwords: Passwords,
    private readonly sessions: SessionsService,
    private readonly twoFactor: TwoFactorService,
    private readonly limiter: RateLimiter,
  ) {}

  async register(body: RegisterBody, client: ClientInfo): Promise<SignedIn> {
    await this.limiter.enforce('auth.register.email', this.subject('email', body.email));
    if (!(await this.captcha.verify(body.captchaToken, client.ip))) {
      throw new AppError('forbidden', 'CAPTCHA check failed');
    }
    this.passwords.assertAcceptable(body.password, [body.email, body.username, body.displayName]);
    const { result, session } = await this.accounts.create(
      {
        email: body.email,
        emailVerified: false,
        passwordHash: await this.passwords.hash(body.password),
        displayName: body.displayName,
        username: body.username,
        birthdate: body.birthdate,
        locale: body.locale ?? 'ru',
        inviteCode: body.inviteCode,
        acceptedTermsVersion: body.acceptedTermsVersion,
        acceptedPrivacyVersion: body.acceptedPrivacyVersion,
        acceptedPdProcessingVersion: body.acceptedPdProcessingVersion,
      },
      client,
    );
    return { result, session };
  }

  /**
   * Brief §8.3: uniform error for unknown identifier and wrong password, lockout per
   * identifier (5 failures / 15 min, then 20 / day), and a per-IP failure ceiling.
   */
  async login(body: LoginBody, client: ClientInfo): Promise<SignedIn | MfaChallenge> {
    const identifier = body.identifier.trim().toLowerCase();
    const idKey = this.subject('login', identifier);
    const ipKey = hashIp(this.keyring.pii, client.ip).toString('hex');
    for (const [rule, subject] of [
      ['auth.login.failures', idKey],
      ['auth.login.failures.daily', idKey],
      ['auth.login.ip_failures', ipKey],
    ] as const) {
      const state = await this.limiter.peek(rule, subject);
      if (!state.allowed) throw rateLimited(state);
    }
    if (!(await this.captcha.verify(body.captchaToken, client.ip))) {
      throw new AppError('forbidden', 'CAPTCHA check failed');
    }

    const [user] = await this.db
      .select()
      .from(users)
      .where(or(eq(users.email, identifier), eq(users.username, identifier)))
      .limit(1);
    const valid = await this.passwords.verify(user?.passwordHash, body.password);
    await this.db.insert(loginAttempts).values({
      identifierHash: Buffer.from(idKey, 'hex'),
      ipHash: hashIp(this.keyring.pii, client.ip),
      success: valid,
    });
    if (!user || !valid) {
      await Promise.all([
        this.limiter.add('auth.login.failures', idKey),
        this.limiter.add('auth.login.failures.daily', idKey),
        this.limiter.add('auth.login.ip_failures', ipKey),
      ]);
      throw new AppError('unauthorized', INVALID_CREDENTIALS);
    }
    await this.limiter.reset('auth.login.failures', idKey);
    await this.assertMaySignIn(user);
    if (user.passwordHash && this.passwords.needsRehash(user.passwordHash)) {
      await this.db
        .update(users)
        .set({ passwordHash: await this.passwords.hash(body.password) })
        .where(eq(users.id, user.id));
    }
    if (await this.twoFactor.isEnabled(user.id)) {
      return this.createMfaChallenge(user.id, body.rememberDevice ?? false);
    }
    return this.db.transaction((tx) =>
      this.accounts.signIn(tx, user, body.rememberDevice ?? false, client),
    );
  }

  /** Sign-in through a linked VK ID / Yandex ID / Google identity; 2FA still applies. */
  async signInExternal(user: UserRow, client: ClientInfo): Promise<SignedIn | MfaChallenge> {
    await this.assertMaySignIn(user);
    if (await this.twoFactor.isEnabled(user.id)) return this.createMfaChallenge(user.id, false);
    return this.db.transaction((tx) => this.accounts.signIn(tx, user, false, client));
  }

  /** Second step of a 2FA login. Five wrong codes burn the challenge. */
  async loginWithMfa(mfaToken: string, code: string, client: ClientInfo): Promise<SignedIn> {
    const key = `auth:mfa:${sha256(mfaToken).toString('hex')}`;
    const raw = await this.redis.get(key);
    if (!raw) throw new AppError('unauthorized', 'Sign-in expired, start again');
    const challenge = JSON.parse(raw) as { userId: string; remember: boolean };
    if (!(await this.twoFactor.verify(challenge.userId, code))) {
      const attempts = await this.redis.incr(`${key}:attempts`);
      await this.redis.expire(`${key}:attempts`, MFA_CHALLENGE_TTL_SEC);
      if (attempts >= MFA_MAX_ATTEMPTS) await this.redis.del(key);
      throw new AppError('unauthorized', 'Wrong code');
    }
    // Single use: whoever deletes the key first signs in.
    if ((await this.redis.del(key)) !== 1)
      throw new AppError('unauthorized', 'Sign-in expired, start again');
    const [user] = await this.db.select().from(users).where(eq(users.id, challenge.userId));
    if (!user) throw new AppError('unauthorized', 'Sign-in expired, start again');
    await this.assertMaySignIn(user);
    return this.db.transaction((tx) => this.accounts.signIn(tx, user, challenge.remember, client));
  }

  async createMfaChallenge(userId: string, remember: boolean): Promise<MfaChallenge> {
    const mfaToken = randomToken();
    await this.redis.set(
      `auth:mfa:${sha256(mfaToken).toString('hex')}`,
      JSON.stringify({ userId, remember }),
      'EX',
      MFA_CHALLENGE_TTL_SEC,
    );
    return { mfaRequired: true, mfaToken };
  }

  /** Rotates the refresh token and issues a new access token (ADR-004). */
  async refresh(refreshToken: string, client: ClientInfo): Promise<SignedIn> {
    const rotated = await this.sessions.rotate(refreshToken, client);
    if (!rotated.ok) throw new AppError('unauthorized', 'Session expired');
    const [user] = await this.db.select().from(users).where(eq(users.id, rotated.userId));
    if (!user) throw new AppError('unauthorized', 'Session expired');
    if (user.status === 'banned' || user.status === 'suspended') {
      await this.sessions.revokeFamily(this.db, rotated.session.familyId);
      await this.assertMaySignIn(user);
    }
    const authUser: AuthUser = {
      id: user.id,
      sessionId: rotated.session.sessionId,
      role: user.role,
      minor: isMinor(user.birthdate),
    };
    return { session: rotated.session, result: await this.accounts.authResult(authUser) };
  }

  async logout(refreshToken: string | undefined): Promise<void> {
    if (refreshToken) await this.sessions.revokeByToken(refreshToken);
  }

  async logoutAll(user: AuthUser, confirm: PasswordConfirm, client: ClientInfo): Promise<void> {
    await this.reauthenticate(user, confirm);
    await this.db.transaction(async (tx) => {
      await this.sessions.revokeAllForUser(tx, user.id);
      await audit(tx, {
        actorId: user.id,
        action: 'session.revoked_all',
        entityType: 'user',
        entityId: user.id,
        ipHash: hashIp(this.keyring.pii, client.ip),
        userAgent: client.userAgent,
      });
    });
  }

  /**
   * Re-authentication for sensitive actions (brief §8.7): the password, or for accounts that
   * only use VK ID / Yandex ID, a sign-in within the last 10 minutes; plus a code when 2FA is on.
   */
  async reauthenticate(user: AuthUser, confirm: PasswordConfirm): Promise<UserRow> {
    const [row] = await this.db.select().from(users).where(eq(users.id, user.id));
    if (!row) throw new AppError('unauthorized', 'Authentication required');
    const fail = (fieldName: string, message: string) =>
      new AppError('reauth_required', 'Confirm it is you', [{ field: fieldName, message }]);
    if (row.passwordHash) {
      if (!confirm.password) throw fail('password', 'password_required');
      if (!(await this.passwords.verify(row.passwordHash, confirm.password))) {
        throw fail('password', 'password_invalid');
      }
    } else {
      const family = await this.sessions.familyOf(user.sessionId);
      if (!family || Date.now() - family.startedAt.getTime() > RECENT_SIGN_IN_MS) {
        throw fail('password', 'recent_sign_in_required');
      }
    }
    if (await this.twoFactor.isEnabled(user.id)) {
      if (!confirm.code) throw fail('code', 'code_required');
      if (!(await this.twoFactor.verify(user.id, confirm.code))) throw fail('code', 'code_invalid');
    }
    return row;
  }

  /** Brief §8.10 and §8.9: clear messages for suspended and banned accounts; login cancels deletion. */
  private async assertMaySignIn(user: UserRow): Promise<void> {
    if (user.status === 'banned') throw new AppError('account_banned', 'This account is banned');
    if (user.status === 'suspended')
      throw new AppError('account_suspended', 'This account is suspended');
    if (user.status === 'pending_deletion') {
      await this.db
        .update(users)
        .set({ status: 'active', deletionScheduledAt: null })
        .where(eq(users.id, user.id));
      await audit(this.db, {
        actorId: user.id,
        action: 'user.deletion_cancelled',
        entityType: 'user',
        entityId: user.id,
      });
    }
  }

  private subject(kind: string, value: string): string {
    return hmac(this.keyring.pii, `${kind}:${value.trim().toLowerCase()}`).toString('hex');
  }
}
