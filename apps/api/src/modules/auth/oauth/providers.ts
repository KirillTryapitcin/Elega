import type { Env } from '../../../config/env.js';

/**
 * External sign-in providers (ADR-011). Endpoints, parameters and response fields follow each
 * provider's current documentation, recorded with links in docs/auth-providers.md.
 */
export type ProviderName = 'vk' | 'yandex' | 'google';

export interface ExternalProfile {
  providerUserId: string;
  email: string | null;
  /** Only Google says whether the address is verified; VK and Yandex addresses are re-verified. */
  emailVerified: boolean;
  displayName: string | null;
  /** ISO date, or null when missing or partial. */
  birthdate: string | null;
}

export interface AuthorizeParams {
  state: string;
  codeChallenge: string;
  redirectUri: string;
}

export interface ExchangeParams {
  code: string;
  codeVerifier: string;
  redirectUri: string;
  state: string;
  /** Every query parameter the provider appended to the callback (VK sends device_id). */
  callback: Record<string, string>;
}

export interface OAuthProvider {
  readonly name: ProviderName;
  readonly configured: boolean;
  authorizeUrl(params: AuthorizeParams): string;
  exchange(params: ExchangeParams): Promise<ExternalProfile>;
}

/** Base URLs, injectable so integration tests can point them at a local fake provider. */
export interface OAuthEndpoints {
  vk: { authorize: string; token: string; userInfo: string };
  yandex: { authorize: string; token: string; userInfo: string };
  google: { authorize: string; token: string; userInfo: string };
}

export const OAUTH_ENDPOINTS = Symbol('OAUTH_ENDPOINTS');
export const OAUTH_PROVIDERS = Symbol('OAUTH_PROVIDERS');

export const DEFAULT_OAUTH_ENDPOINTS: OAuthEndpoints = {
  // https://id.vk.ru/about/business/go/docs/ru/vkid/latest/vk-id/connection/api-description
  vk: {
    authorize: 'https://id.vk.ru/authorize',
    token: 'https://id.vk.ru/oauth2/auth',
    userInfo: 'https://id.vk.ru/oauth2/user_info',
  },
  // https://yandex.ru/dev/id/doc/ru/codes/code-url, https://yandex.ru/dev/id/doc/ru/user-information
  yandex: {
    authorize: 'https://oauth.yandex.ru/authorize',
    token: 'https://oauth.yandex.ru/token',
    userInfo: 'https://login.yandex.ru/info?format=json',
  },
  // https://developers.google.com/identity/openid-connect/openid-connect
  google: {
    authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
    token: 'https://oauth2.googleapis.com/token',
    userInfo: 'https://openidconnect.googleapis.com/v1/userinfo',
  },
};

const TIMEOUT_MS = 10_000;

export class ProviderError extends Error {
  constructor(
    readonly provider: ProviderName,
    readonly reason: string,
  ) {
    super(`${provider}: ${reason}`);
    this.name = 'ProviderError';
  }
}

async function postForm(
  provider: ProviderName,
  url: string,
  form: Record<string, string>,
  headers: Record<string, string> = {},
) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json',
      ...headers,
    },
    body: new URLSearchParams(form),
    signal: AbortSignal.timeout(TIMEOUT_MS),
    redirect: 'error',
  });
  const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response.ok || !body || typeof body.error === 'string') {
    throw new ProviderError(provider, `token or profile request failed (${response.status})`);
  }
  return body;
}

async function getJson(provider: ProviderName, url: string, headers: Record<string, string>) {
  const response = await fetch(url, {
    headers: { accept: 'application/json', ...headers },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    redirect: 'error',
  });
  const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response.ok || !body)
    throw new ProviderError(provider, `profile request failed (${response.status})`);
  return body;
}

const str = (value: unknown): string | null =>
  typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : typeof value === 'number'
      ? String(value)
      : null;

/** Accepts YYYY-MM-DD or DD.MM.YYYY; zeros for unknown parts (Yandex) mean "no date". */
export function parseProviderBirthdate(value: unknown): string | null {
  const text = str(value);
  if (!text) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  const dotted = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(text);
  const [y, m, d] = iso
    ? [iso[1]!, iso[2]!, iso[3]!]
    : dotted
      ? [dotted[3]!, dotted[2]!.padStart(2, '0'), dotted[1]!.padStart(2, '0')]
      : [];
  if (!y || !m || !d || y === '0000' || m === '00' || d === '00') return null;
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  if (date.getUTCMonth() !== Number(m) - 1 || date.getUTCDate() !== Number(d)) return null;
  return `${y}-${m}-${d}`;
}

const nameOf = (...parts: unknown[]): string | null => {
  const joined = parts.map(str).filter(Boolean).join(' ').slice(0, 64);
  return joined.length > 0 ? joined : null;
};

class VkProvider implements OAuthProvider {
  readonly name = 'vk' as const;

  constructor(
    private readonly endpoints: OAuthEndpoints['vk'],
    private readonly clientId: string | undefined,
  ) {}

  get configured() {
    return Boolean(this.clientId);
  }

  authorizeUrl({ state, codeChallenge, redirectUri }: AuthorizeParams): string {
    const url = new URL(this.endpoints.authorize);
    url.search = new URLSearchParams({
      response_type: 'code',
      client_id: this.clientId!,
      redirect_uri: redirectUri,
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      scope: 'vkid.personal_info email',
      lang_id: '0',
    }).toString();
    return url.toString();
  }

  async exchange({
    code,
    codeVerifier,
    redirectUri,
    state,
    callback,
  }: ExchangeParams): Promise<ExternalProfile> {
    const deviceId = callback.device_id;
    if (!deviceId) throw new ProviderError('vk', 'callback without device_id');
    const token = await postForm('vk', this.endpoints.token, {
      grant_type: 'authorization_code',
      code,
      code_verifier: codeVerifier,
      redirect_uri: redirectUri,
      client_id: this.clientId!,
      device_id: deviceId,
      state,
    });
    const accessToken = str(token.access_token);
    if (!accessToken) throw new ProviderError('vk', 'no access token');
    const info = await postForm('vk', this.endpoints.userInfo, {
      client_id: this.clientId!,
      access_token: accessToken,
    });
    const user = (info.user ?? {}) as Record<string, unknown>;
    const id = str(user.user_id) ?? str(token.user_id);
    if (!id) throw new ProviderError('vk', 'profile without user_id');
    return {
      providerUserId: id,
      email: str(user.email)?.toLowerCase() ?? null,
      emailVerified: false,
      displayName: nameOf(user.first_name, user.last_name),
      birthdate: parseProviderBirthdate(user.birthday),
    };
  }
}

class YandexProvider implements OAuthProvider {
  readonly name = 'yandex' as const;

  constructor(
    private readonly endpoints: OAuthEndpoints['yandex'],
    private readonly clientId: string | undefined,
    private readonly clientSecret: string | undefined,
  ) {}

  get configured() {
    return Boolean(this.clientId);
  }

  authorizeUrl({ state, codeChallenge, redirectUri }: AuthorizeParams): string {
    const url = new URL(this.endpoints.authorize);
    // No `scope`: the rights (name, email, birthday) are set on the app at oauth.yandex.ru.
    url.search = new URLSearchParams({
      response_type: 'code',
      client_id: this.clientId!,
      redirect_uri: redirectUri,
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    }).toString();
    return url.toString();
  }

  async exchange({ code, codeVerifier }: ExchangeParams): Promise<ExternalProfile> {
    const token = await postForm('yandex', this.endpoints.token, {
      grant_type: 'authorization_code',
      code,
      code_verifier: codeVerifier,
      client_id: this.clientId!,
      ...(this.clientSecret ? { client_secret: this.clientSecret } : {}),
    });
    const accessToken = str(token.access_token);
    if (!accessToken) throw new ProviderError('yandex', 'no access token');
    const info = await getJson('yandex', this.endpoints.userInfo, {
      authorization: `OAuth ${accessToken}`,
    });
    const id = str(info.id);
    if (!id) throw new ProviderError('yandex', 'profile without id');
    return {
      providerUserId: id,
      email: str(info.default_email)?.toLowerCase() ?? null,
      emailVerified: false,
      displayName: str(info.display_name) ?? nameOf(info.first_name, info.last_name),
      birthdate: parseProviderBirthdate(info.birthday),
    };
  }
}

class GoogleProvider implements OAuthProvider {
  readonly name = 'google' as const;

  constructor(
    private readonly endpoints: OAuthEndpoints['google'],
    private readonly clientId: string | undefined,
    private readonly clientSecret: string | undefined,
  ) {}

  get configured() {
    return Boolean(this.clientId && this.clientSecret);
  }

  authorizeUrl({ state, codeChallenge, redirectUri }: AuthorizeParams): string {
    const url = new URL(this.endpoints.authorize);
    url.search = new URLSearchParams({
      response_type: 'code',
      client_id: this.clientId!,
      redirect_uri: redirectUri,
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      scope: 'openid email profile',
    }).toString();
    return url.toString();
  }

  async exchange({ code, codeVerifier, redirectUri }: ExchangeParams): Promise<ExternalProfile> {
    const token = await postForm('google', this.endpoints.token, {
      grant_type: 'authorization_code',
      code,
      code_verifier: codeVerifier,
      redirect_uri: redirectUri,
      client_id: this.clientId!,
      client_secret: this.clientSecret!,
    });
    const accessToken = str(token.access_token);
    if (!accessToken) throw new ProviderError('google', 'no access token');
    const info = await getJson('google', this.endpoints.userInfo, {
      authorization: `Bearer ${accessToken}`,
    });
    const id = str(info.sub);
    if (!id) throw new ProviderError('google', 'profile without sub');
    return {
      providerUserId: id,
      email: str(info.email)?.toLowerCase() ?? null,
      emailVerified: info.email_verified === true,
      displayName: str(info.name),
      birthdate: null,
    };
  }
}

export function createProviders(
  env: Env,
  endpoints: OAuthEndpoints,
): Record<ProviderName, OAuthProvider> {
  return {
    vk: new VkProvider(endpoints.vk, env.VK_CLIENT_ID),
    yandex: new YandexProvider(endpoints.yandex, env.YANDEX_CLIENT_ID, env.YANDEX_CLIENT_SECRET),
    google: new GoogleProvider(endpoints.google, env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET),
  };
}
