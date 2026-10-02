import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, gt, isNull } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import { ENV, type Env } from '../../../config/env.js';
import { authCredentials, sessions, users } from '../../../db/schema.js';
import {
  hmac,
  KEYRING,
  type Keyring,
  randomToken,
  safeEqual,
  sha256,
} from '../../../platform/crypto.js';
import { DB, type Db } from '../../../platform/database.js';
import { AppError } from '../../../platform/errors/app-error.js';
import { FeatureFlags } from '../../../platform/feature-flags.js';
import { audit, enqueueEmail } from '../../../platform/outbox.js';
import { REDIS } from '../../../platform/redis.js';
import { type ClientInfo, hashIp } from '../../../platform/request-context.js';
import { AccountsService } from '../accounts.service.js';
import type { OAuthCompleteBody } from '../auth.schemas.js';
import { AuthService, type SignedIn } from '../auth.service.js';
import {
  type ExternalProfile,
  OAUTH_PROVIDERS,
  type OAuthProvider,
  type ProviderName,
} from './providers.js';

const STATE_TTL_SEC = 600;
const PENDING_TTL_SEC = 1800;

interface FlowState {
  provider: ProviderName;
  verifier: string;
  intent: 'login' | 'link';
  userId: string | null;
}

interface PendingSignup extends ExternalProfile {
  provider: ProviderName;
}

/** Where the callback sends the browser. Secrets travel in the fragment, never the query. */
export type CallbackOutcome =
  { kind: 'signed_in'; signedIn: SignedIn } | { kind: 'redirect'; path: string };

/** VK ID, Yandex ID and (behind `auth.google`) Google sign-in, ADR-011. */
@Injectable()
export class OAuthService {
  private readonly logger = new Logger(OAuthService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(ENV) private readonly env: Env,
    @Inject(KEYRING) private readonly keyring: Keyring,
    @Inject(OAUTH_PROVIDERS) private readonly providers: Record<ProviderName, OAuthProvider>,
    private readonly flags: FeatureFlags,
    private readonly accounts: AccountsService,
    private readonly auth: AuthService,
  ) {}

  /** Providers shown on the sign-in page: configured, and for Google also flagged on. */
  async enabledProviders(): Promise<ProviderName[]> {
    const names: ProviderName[] = [];
    for (const provider of Object.values(this.providers)) {
      if (!provider.configured) continue;
      if (provider.name === 'google' && !(await this.flags.isEnabled('auth.google'))) continue;
      names.push(provider.name);
    }
    return names;
  }

  redirectUri(provider: ProviderName): string {
    return `${this.env.APP_BASE_URL}/api/v1/auth/oauth/${provider}/callback`;
  }

  /** Returns the provider URL and the value of the browser-binding cookie. */
  async start(
    provider: ProviderName,
    intent: 'login' | 'link',
    refreshToken: string | undefined,
  ): Promise<{ url: string; binding: string } | { path: string }> {
    const client = await this.provider(provider);
    let userId: string | null = null;
    if (intent === 'link') {
      userId = refreshToken ? await this.userFromRefreshToken(refreshToken) : null;
      if (!userId) return { path: '/login#oauthError=signin_required' };
    }
    const state = randomToken(32);
    const verifier = randomToken(48);
    const flow: FlowState = { provider, verifier, intent, userId };
    await this.redis.set(this.stateKey(state), JSON.stringify(flow), 'EX', STATE_TTL_SEC);
    const url = client.authorizeUrl({
      state,
      codeChallenge: sha256(verifier).toString('base64url'),
      redirectUri: this.redirectUri(provider),
    });
    return { url, binding: this.binding(state) };
  }

  async callback(
    provider: ProviderName,
    query: Record<string, string>,
    binding: string | undefined,
    client: ClientInfo,
  ): Promise<CallbackOutcome> {
    const fail = (code: string): CallbackOutcome => ({
      kind: 'redirect',
      path: `/login#oauthError=${code}`,
    });
    const state = query.state;
    if (!state || state.length > 1024) return fail('invalid_state');
    const raw = await this.redis.getdel(this.stateKey(state));
    if (!raw) return fail('expired');
    const flow = JSON.parse(raw) as FlowState;
    // Login CSRF: the state must come back to the browser that started the flow.
    if (
      flow.provider !== provider ||
      !binding ||
      !safeEqual(Buffer.from(binding), Buffer.from(this.binding(state)))
    ) {
      return fail('invalid_state');
    }
    if (query.error || !query.code) return fail('cancelled');

    let profile: ExternalProfile;
    try {
      profile = await (
        await this.provider(provider)
      ).exchange({
        code: query.code,
        codeVerifier: flow.verifier,
        redirectUri: this.redirectUri(provider),
        state,
        callback: query,
      });
    } catch (error) {
      this.logger.warn({ provider, err: (error as Error).message }, 'OAuth exchange failed');
      return fail('provider_error');
    }

    const [credential] = await this.db
      .select({ userId: authCredentials.userId })
      .from(authCredentials)
      .where(
        and(
          eq(authCredentials.provider, provider),
          eq(authCredentials.providerUserId, profile.providerUserId),
        ),
      );

    if (flow.intent === 'link')
      return this.link(flow.userId!, provider, profile, credential?.userId, client);

    if (credential) {
      const [user] = await this.db.select().from(users).where(eq(users.id, credential.userId));
      if (!user) return fail('provider_error');
      if (user.status === 'banned') return fail('account_banned');
      if (user.status === 'suspended') return fail('account_suspended');
      const outcome = await this.auth.signInExternal(user, client);
      if ('mfaToken' in outcome)
        return { kind: 'redirect', path: `/login#mfa=${outcome.mfaToken}` };
      return { kind: 'signed_in', signedIn: outcome };
    }

    // ADR-011: never attach an external identity to an existing account by email alone.
    if (profile.email) {
      const [existing] = await this.db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, profile.email));
      if (existing) return fail('account_exists');
    }
    const token = randomToken();
    const pending: PendingSignup = { ...profile, provider };
    await this.redis.set(this.pendingKey(token), JSON.stringify(pending), 'EX', PENDING_TTL_SEC);
    return { kind: 'redirect', path: `/signup/complete#token=${token}` };
  }

  async pending(token: string) {
    const pending = await this.readPending(token);
    return {
      provider: pending.provider,
      email: pending.email,
      displayName: pending.displayName,
      birthdate: pending.birthdate,
    };
  }

  /** Finishes an external sign-up: birthdate and consents are recorded like any other. */
  async complete(body: OAuthCompleteBody, client: ClientInfo): Promise<SignedIn> {
    const pending = await this.readPending(body.token);
    const email = pending.email ?? body.email;
    if (!email) {
      throw new AppError('validation_failed', 'Validation failed', [
        { field: 'email', message: 'email_required' },
      ]);
    }
    const { result, session } = await this.accounts.create(
      {
        email,
        emailVerified: pending.email !== null && pending.emailVerified,
        passwordHash: null,
        displayName: body.displayName,
        username: body.username,
        birthdate: body.birthdate,
        locale: body.locale ?? 'ru',
        inviteCode: body.inviteCode,
        acceptedTermsVersion: body.acceptedTermsVersion,
        acceptedPrivacyVersion: body.acceptedPrivacyVersion,
        acceptedPdProcessingVersion: body.acceptedPdProcessingVersion,
        external: { provider: pending.provider, providerUserId: pending.providerUserId },
      },
      client,
    );
    await this.redis.del(this.pendingKey(body.token));
    return { result, session };
  }

  private async link(
    userId: string,
    provider: ProviderName,
    profile: ExternalProfile,
    ownerId: string | undefined,
    client: ClientInfo,
  ): Promise<CallbackOutcome> {
    if (ownerId && ownerId !== userId)
      return { kind: 'redirect', path: '/settings/security#linkError=already_linked' };
    if (ownerId === userId)
      return { kind: 'redirect', path: `/settings/security#linked=${provider}` };
    try {
      await this.db.transaction(async (tx) => {
        await tx
          .insert(authCredentials)
          .values({ userId, provider, providerUserId: profile.providerUserId });
        const [user] = await tx.select().from(users).where(eq(users.id, userId));
        if (user) {
          await enqueueEmail(tx, userId, {
            template: 'provider_linked',
            to: user.email,
            locale: user.locale,
            linkPath: '/settings/security',
            params: { name: user.displayName, provider },
          });
        }
        await audit(tx, {
          actorId: userId,
          action: `user.provider_linked.${provider}`,
          entityType: 'user',
          entityId: userId,
          ipHash: hashIp(this.keyring.pii, client.ip),
          userAgent: client.userAgent,
        });
      });
    } catch (error) {
      if ((error as { code?: string }).code === '23505') {
        return { kind: 'redirect', path: '/settings/security#linkError=provider_already_linked' };
      }
      throw error;
    }
    return { kind: 'redirect', path: `/settings/security#linked=${provider}` };
  }

  private async provider(name: ProviderName): Promise<OAuthProvider> {
    const enabled = await this.enabledProviders();
    const provider = this.providers[name];
    if (!enabled.includes(name)) throw new AppError('not_found', 'Not found');
    return provider;
  }

  /** The refresh cookie identifies who is linking; it is read, never rotated, here. */
  private async userFromRefreshToken(refreshToken: string): Promise<string | null> {
    const [row] = await this.db
      .select({ userId: sessions.userId })
      .from(sessions)
      .where(
        and(
          eq(sessions.refreshTokenHash, sha256(refreshToken)),
          isNull(sessions.revokedAt),
          gt(sessions.expiresAt, new Date()),
        ),
      );
    return row?.userId ?? null;
  }

  private async readPending(token: string): Promise<PendingSignup> {
    const raw = await this.redis.get(this.pendingKey(token));
    if (!raw) {
      throw new AppError('validation_failed', 'This link is invalid or has expired', [
        { field: 'token', message: 'token_invalid' },
      ]);
    }
    return JSON.parse(raw) as PendingSignup;
  }

  private binding(state: string): string {
    return hmac(this.keyring.state, `oauth:${state}`).toString('base64url');
  }

  private stateKey(state: string): string {
    return `oauth:state:${sha256(state).toString('hex')}`;
  }

  private pendingKey(token: string): string {
    return `oauth:pending:${sha256(token).toString('hex')}`;
  }
}
