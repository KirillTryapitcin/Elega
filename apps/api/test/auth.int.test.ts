import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Secret, TOTP } from 'otpauth';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Invites } from '../src/modules/auth/index.js';
import { getDb } from './db.js';
import {
  APP_BASE_URL,
  buildApp,
  cookieValue,
  type Infra,
  startFakeProvider,
  startInfra,
} from './harness.js';

const RT = '__Host-elega_rt';
const LEGAL = {
  acceptedTermsVersion: '2026-10-01',
  acceptedPrivacyVersion: '2026-10-01',
  acceptedPdProcessingVersion: '2026-10-01',
};
const PASSWORD = 'correct horse battery staple';

let infra: Infra;
let app: NestFastifyApplication;
let fake: Awaited<ReturnType<typeof startFakeProvider>>;
let vkProfile: Record<string, unknown> = {};
let ipCounter = 0;

/** Each test registers from its own address so per-IP limits don't leak between tests. */
const nextIp = () => `10.0.${Math.floor(++ipCounter / 250)}.${(ipCounter % 250) + 1}`;

beforeAll(async () => {
  infra = await startInfra({ VK_CLIENT_ID: 'vk-test-client' });
  fake = await startFakeProvider(() => vkProfile);
  app = await buildApp(fake.endpoints);
});

afterAll(async () => {
  await app?.close();
  await fake?.close();
  await infra?.stop();
});

async function invite(): Promise<string> {
  return app.get(Invites, { strict: false }).create(getDb(infra), {});
}

function birthdate(yearsAgo: number): string {
  const date = new Date();
  date.setUTCFullYear(date.getUTCFullYear() - yearsAgo);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

let userCounter = 0;
async function register(overrides: Record<string, unknown> = {}, ip = nextIp()) {
  userCounter += 1;
  const body = {
    email: `user${userCounter}@example.ru`,
    password: PASSWORD,
    displayName: `User ${userCounter}`,
    username: `user_${userCounter}`,
    birthdate: birthdate(30),
    inviteCode: await invite(),
    ...LEGAL,
    ...overrides,
  };
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: body,
    remoteAddress: ip,
  });
  return { res, body, ip };
}

async function lastEmailToken(to: string, template: string): Promise<string> {
  const { rows } = await infra.pool.query<{ payload_json: { linkPath: string } }>(
    `SELECT payload_json FROM outbox WHERE payload_json->>'to' = $1 AND payload_json->>'template' = $2
     ORDER BY id DESC LIMIT 1`,
    [to, template],
  );
  const link = rows[0]?.payload_json.linkPath ?? '';
  return link.split('#token=')[1] ?? '';
}

const csrf = { 'x-elega-csrf': '1', origin: APP_BASE_URL };

function refresh(token: string, ip = '10.9.0.1') {
  return app.inject({
    method: 'POST',
    url: '/api/v1/auth/refresh',
    headers: { ...csrf, cookie: `${RT}=${token}` },
    remoteAddress: ip,
  });
}

function me(accessToken: string) {
  return app.inject({
    method: 'GET',
    url: '/api/v1/me',
    headers: { authorization: `Bearer ${accessToken}` },
  });
}

describe('registration', () => {
  it('requires a valid single-use invite while registration is invite-only', async () => {
    const missing = await register({ inviteCode: undefined });
    expect(missing.res.statusCode).toBe(400);
    expect(missing.res.json().error.details).toContainEqual({
      field: 'inviteCode',
      message: 'invite_invalid',
    });

    const code = await invite();
    const first = await register({ inviteCode: code });
    expect(first.res.statusCode).toBe(201);
    const reused = await register({ inviteCode: code });
    expect(reused.res.statusCode).toBe(400);
  });

  it('signs the new account in, unverified, with a refresh cookie and a verification email', async () => {
    const { res, body } = await register({ email: 'Anya.K@Example.RU' });
    expect(res.statusCode).toBe(201);
    const result = res.json();
    expect(result).toMatchObject({
      expiresIn: 900,
      user: {
        email: 'anya.k@example.ru',
        emailVerified: false,
        isMinor: false,
        hasPassword: true,
        twoFactorEnabled: false,
      },
    });
    const setCookie = [res.headers['set-cookie']].flat().join('\n');
    expect(setCookie).toMatch(/__Host-elega_rt=[\w-]{43}; Path=\/; HttpOnly; Secure; SameSite=Lax/);
    // The script-readable hint carries no secret and is not HttpOnly.
    expect(setCookie).toMatch(/__Host-elega_signed_in=1; Path=\/; Secure; SameSite=Lax(\n|$)/);
    expect(setCookie).not.toMatch(/Max-Age/); // browser-session cookie without "remember"
    expect((await me(result.accessToken)).json().username).toBe(body.username);

    const token = await lastEmailToken('anya.k@example.ru', 'verify_email');
    expect(token).toHaveLength(43);
    const verify = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/verify-email',
      payload: { token },
    });
    expect(verify.json()).toEqual({ ok: true });
    expect((await me(result.accessToken)).json().emailVerified).toBe(true);
    const again = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/verify-email',
      payload: { token },
    });
    expect(again.statusCode).toBe(400);
  });

  it('rejects under-14s, disposable domains, weak passwords, reserved names and outdated consents', async () => {
    const cases: Array<[Record<string, unknown>, string, string]> = [
      [{ birthdate: birthdate(13) }, 'birthdate', 'birthdate_too_young'],
      [{ email: 'x@mailinator.com' }, 'email', 'email_domain_not_allowed'],
      [{ password: 'qwerty12345' }, 'password', 'password_too_weak'],
      [{ username: 'sup.port' }, 'username', 'username_reserved'],
      [
        { acceptedPdProcessingVersion: '2020-01-01' },
        'acceptedPdProcessingVersion',
        'version_outdated',
      ],
    ];
    for (const [overrides, field, message] of cases) {
      const { res } = await register(overrides);
      expect(res.statusCode, JSON.stringify(overrides)).toBe(400);
      expect(res.json().error.details).toContainEqual({ field, message });
    }
  });

  it('returns 409 for a taken email or username', async () => {
    const first = await register();
    expect(first.res.statusCode).toBe(201);
    const sameEmail = await register({ email: first.body.email.toUpperCase() });
    expect(sameEmail.res.statusCode).toBe(409);
    const sameName = await register({ username: first.body.username });
    expect(sameName.res.statusCode).toBe(409);
  });

  it('gives minors private defaults they cannot loosen', async () => {
    const { res } = await register({ birthdate: birthdate(15) });
    const { accessToken, user } = res.json();
    expect(user.isMinor).toBe(true);
    const settings = await app.inject({
      method: 'GET',
      url: '/api/v1/me/settings',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(settings.json()).toMatchObject({
      whoCanMessage: 'friends',
      allowFollowers: false,
      searchEngineIndexing: false,
    });
    const loosen = await app.inject({
      method: 'PATCH',
      url: '/api/v1/me/settings',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { whoCanMessage: 'everyone', theme: 'dark' },
    });
    expect(loosen.statusCode).toBe(403);
    const ok = await app.inject({
      method: 'PATCH',
      url: '/api/v1/me/settings',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { theme: 'dark' },
    });
    expect(ok.json().theme).toBe('dark');
  });

  it('limits sign-ups per IP with 429, Retry-After and RateLimit headers', async () => {
    const ip = nextIp();
    const statuses: number[] = [];
    for (let i = 0; i < 6; i += 1) statuses.push((await register({}, ip)).res.statusCode);
    expect(statuses.slice(0, 5)).toEqual([201, 201, 201, 201, 201]);
    const limited = await register({}, ip);
    expect(limited.res.statusCode).toBe(429);
    expect(Number(limited.res.headers['retry-after'])).toBeGreaterThan(0);
    expect(limited.res.headers['ratelimit-limit']).toBe('5');
    expect(limited.res.json().error.code).toBe('rate_limited');
  });
});

describe('login', () => {
  it('accepts email or username and gives a uniform 401 otherwise', async () => {
    const { body } = await register();
    for (const identifier of [body.email, body.username.toUpperCase()]) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { identifier, password: PASSWORD, rememberDevice: true },
        remoteAddress: nextIp(),
      });
      expect(res.statusCode).toBe(200);
      expect([res.headers['set-cookie']].flat().join()).toMatch(/Max-Age=259\d{4}/);
    }
    const wrong = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { identifier: body.email, password: 'wrong password!' },
      remoteAddress: nextIp(),
    });
    const unknown = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { identifier: 'nobody@example.ru', password: 'wrong password!' },
      remoteAddress: nextIp(),
    });
    expect(wrong.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(wrong.json().error.message).toBe(unknown.json().error.message);
  });

  it('locks an identifier after five failures, then a reset lifts it', async () => {
    const { body } = await register();
    const attempt = (password: string) =>
      app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { identifier: body.email, password },
        remoteAddress: nextIp(),
      });
    for (let i = 0; i < 5; i += 1)
      expect((await attempt('bad password ' + i)).statusCode).toBe(401);
    const locked = await attempt(PASSWORD);
    expect(locked.statusCode).toBe(429);
    expect(Number(locked.headers['retry-after'])).toBeGreaterThan(0);

    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/forgot-password',
      payload: { email: body.email },
    });
    const token = await lastEmailToken(body.email, 'reset_password');
    const reset = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/reset-password',
      payload: { token, newPassword: 'another long passphrase' },
    });
    expect(reset.statusCode).toBe(204);
    expect((await attempt('another long passphrase')).statusCode).toBe(200);
  });
});

describe('sessions', () => {
  it('rotates refresh tokens and revokes the family when a rotated token is replayed', async () => {
    const { res } = await register();
    const first = cookieValue(res.headers['set-cookie'], RT)!;
    const rotated = await refresh(first);
    expect(rotated.statusCode).toBe(200);
    const second = cookieValue(rotated.headers['set-cookie'], RT)!;
    expect(second).not.toBe(first);

    // A replay inside the 5-second grace window (two tabs) is refused without revoking.
    expect((await refresh(first)).statusCode).toBe(401);

    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 10_000);
    try {
      const replay = await refresh(first);
      expect(replay.statusCode).toBe(401);
    } finally {
      vi.useRealTimers();
    }
    // The thief's replay killed the legitimate token too, and its access token.
    expect((await refresh(second)).statusCode).toBe(401);
    expect((await me(rotated.json().accessToken)).statusCode).toBe(401);
    const { rows } = await infra.pool.query(
      "SELECT 1 FROM audit_log WHERE action = 'session.refresh_reuse_detected'",
    );
    expect(rows.length).toBeGreaterThan(0);
  });

  it('refuses refresh without the CSRF header or from another origin', async () => {
    const { res } = await register();
    const token = cookieValue(res.headers['set-cookie'], RT)!;
    const noHeader = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      headers: { cookie: `${RT}=${token}` },
    });
    expect(noHeader.statusCode).toBe(403);
    const otherOrigin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      headers: { cookie: `${RT}=${token}`, 'x-elega-csrf': '1', origin: 'https://evil.example' },
    });
    expect(otherOrigin.statusCode).toBe(403);
  });

  it('lists sessions, logs out one device and everywhere', async () => {
    const { res, body } = await register();
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { identifier: body.email, password: PASSWORD },
      headers: {
        'user-agent': 'Mozilla/5.0 (Linux; Android 14) Chrome/130.0 Mobile Safari/537.36',
      },
      remoteAddress: nextIp(),
    });
    const access = res.json().accessToken as string;
    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/sessions',
      headers: { authorization: `Bearer ${access}` },
    });
    const sessions = list.json().data as Array<{
      id: string;
      current: boolean;
      deviceName?: string;
    }>;
    expect(sessions).toHaveLength(2);
    expect(sessions.filter((s) => s.current)).toHaveLength(1);
    const phone = sessions.find((s) => !s.current)!;
    expect(phone.deviceName).toBe('Chrome · Android');

    const other = await register();
    const foreign = await app.inject({
      method: 'DELETE',
      url: `/api/v1/auth/sessions/${phone.id}`,
      headers: { authorization: `Bearer ${other.res.json().accessToken}` },
    });
    expect(foreign.statusCode).toBe(404);

    const drop = await app.inject({
      method: 'DELETE',
      url: `/api/v1/auth/sessions/${phone.id}`,
      headers: { authorization: `Bearer ${access}` },
    });
    expect(drop.statusCode).toBe(204);
    expect((await me(login.json().accessToken)).statusCode).toBe(401);
    expect((await refresh(cookieValue(login.headers['set-cookie'], RT)!)).statusCode).toBe(401);

    const wrong = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout-all',
      headers: { authorization: `Bearer ${access}` },
      payload: { password: 'not my password' },
    });
    expect(wrong.statusCode).toBe(403);
    expect(wrong.json().error.code).toBe('reauth_required');
    const all = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout-all',
      headers: { authorization: `Bearer ${access}` },
      payload: { password: PASSWORD },
    });
    expect(all.statusCode).toBe(204);
    expect((await me(access)).statusCode).toBe(401);
    expect((await refresh(cookieValue(res.headers['set-cookie'], RT)!)).statusCode).toBe(401);
  });

  it('logout revokes the cookie session', async () => {
    const { res } = await register();
    const token = cookieValue(res.headers['set-cookie'], RT)!;
    const out = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { ...csrf, cookie: `${RT}=${token}` },
    });
    expect(out.statusCode).toBe(204);
    expect([out.headers['set-cookie']].flat().join()).toMatch(/__Host-elega_rt=;/);
    expect([out.headers['set-cookie']].flat().join()).toMatch(/__Host-elega_signed_in=;/);
    expect((await refresh(token)).statusCode).toBe(401);
  });

  it('rejects missing and forged access tokens', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/v1/me' })).statusCode).toBe(401);
    const { res } = await register();
    const [header, payload] = (res.json().accessToken as string).split('.');
    const forged = `${header}.${payload}.${'A'.repeat(86)}`;
    expect((await me(forged)).statusCode).toBe(401);
  });
});

describe('account security', () => {
  it('forgot-password answers the same for unknown addresses', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/forgot-password',
      payload: { email: 'ghost@example.ru' },
    });
    expect(res.statusCode).toBe(202);
    expect(res.body).toBe('');
  });

  it('reset revokes every session', async () => {
    const { res, body } = await register();
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/forgot-password',
      payload: { email: body.email },
    });
    const token = await lastEmailToken(body.email, 'reset_password');
    const reset = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/reset-password',
      payload: { token, newPassword: 'brand new pass phrase' },
    });
    expect(reset.statusCode).toBe(204);
    expect((await me(res.json().accessToken)).statusCode).toBe(401);
    const reuse = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/reset-password',
      payload: { token, newPassword: 'brand new pass phrase 2' },
    });
    expect(reuse.statusCode).toBe(400);
  });

  it('change password keeps this session and ends the others', async () => {
    const { res, body } = await register();
    const other = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { identifier: body.email, password: PASSWORD },
      remoteAddress: nextIp(),
    });
    const access = res.json().accessToken as string;
    const change = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/change-password',
      headers: { authorization: `Bearer ${access}` },
      payload: { currentPassword: PASSWORD, newPassword: 'a different passphrase' },
    });
    expect(change.statusCode).toBe(204);
    expect((await me(access)).statusCode).toBe(200);
    expect((await me(other.json().accessToken)).statusCode).toBe(401);
  });

  it('change email confirms at the new address and notifies the old one', async () => {
    const { res, body } = await register();
    const access = res.json().accessToken as string;
    const start = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/change-email',
      headers: { authorization: `Bearer ${access}` },
      payload: { currentPassword: PASSWORD, newEmail: 'moved@example.ru' },
    });
    expect(start.statusCode).toBe(202);
    expect(await lastEmailToken(body.email, 'change_email_notice')).toBe('');
    const token = await lastEmailToken('moved@example.ru', 'change_email_confirm');
    await app.inject({ method: 'POST', url: '/api/v1/auth/verify-email', payload: { token } });
    expect((await me(access)).json()).toMatchObject({
      email: 'moved@example.ru',
      emailVerified: true,
    });
  });

  it('enables 2FA, then requires a code at login; recovery codes work once', async () => {
    const { res, body } = await register();
    const auth = { authorization: `Bearer ${res.json().accessToken}` };
    const noPassword = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/2fa/setup',
      headers: auth,
      payload: {},
    });
    expect(noPassword.statusCode).toBe(403);
    const setup = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/2fa/setup',
      headers: auth,
      payload: { password: PASSWORD },
    });
    expect(setup.statusCode).toBe(200);
    const { otpauthUrl, qrSvg } = setup.json();
    expect(qrSvg).toMatch(/^<svg/);
    const secret = Secret.fromBase32(new URL(otpauthUrl).searchParams.get('secret')!);
    const totp = new TOTP({ secret });
    const confirm = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/2fa/confirm',
      headers: auth,
      payload: { code: totp.generate() },
    });
    expect(confirm.statusCode).toBe(200);
    const { recoveryCodes } = confirm.json();
    expect(recoveryCodes).toHaveLength(10);

    const login = () =>
      app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { identifier: body.email, password: PASSWORD },
        remoteAddress: nextIp(),
      });
    const challenge = (await login()).json();
    expect(challenge).toEqual({ mfaRequired: true, mfaToken: expect.any(String) });
    // The confirm code is spent; the next time step's code is accepted.
    const replayed = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login/2fa',
      payload: { mfaToken: challenge.mfaToken, code: totp.generate() },
    });
    expect(replayed.statusCode).toBe(401);
    const ok = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login/2fa',
      payload: {
        mfaToken: challenge.mfaToken,
        code: totp.generate({ timestamp: Date.now() + 30_000 }),
      },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().user.twoFactorEnabled).toBe(true);

    const second = (await login()).json();
    const recovery = (code: string, mfaToken: string) =>
      app.inject({ method: 'POST', url: '/api/v1/auth/login/2fa', payload: { mfaToken, code } });
    expect((await recovery(recoveryCodes[0], second.mfaToken)).statusCode).toBe(200);
    const third = (await login()).json();
    expect((await recovery(recoveryCodes[0], third.mfaToken)).statusCode).toBe(401);
  });
});

describe('VK ID sign-in', () => {
  async function startFlow(intent = 'login', cookie?: string) {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/auth/oauth/vk/start?intent=${intent}`,
      remoteAddress: nextIp(),
      ...(cookie ? { headers: { cookie } } : {}),
    });
    return res;
  }

  async function finishFlow(start: Awaited<ReturnType<typeof startFlow>>, binding?: string) {
    const location = new URL(start.headers.location as string);
    const state = location.searchParams.get('state')!;
    const value = binding ?? cookieValue(start.headers['set-cookie'], '__Host-elega_oauth');
    return app.inject({
      method: 'GET',
      url: `/api/v1/auth/oauth/vk/callback?code=abc&state=${state}&device_id=dev-1`,
      headers: { cookie: `__Host-elega_oauth=${value}` },
      remoteAddress: nextIp(),
    });
  }

  it('redirects with PKCE and a state bound to the browser', async () => {
    const start = await startFlow();
    expect(start.statusCode).toBe(302);
    const location = new URL(start.headers.location as string);
    expect(location.searchParams.get('code_challenge_method')).toBe('S256');
    expect(location.searchParams.get('state')!.length).toBeGreaterThanOrEqual(32);
    expect(location.searchParams.get('redirect_uri')).toBe(
      `${APP_BASE_URL}/api/v1/auth/oauth/vk/callback`,
    );
    const forged = await finishFlow(start, 'not-the-binding');
    expect(forged.headers.location).toBe(`${APP_BASE_URL}/login#oauthError=invalid_state`);
  });

  it('sends a new identity to complete sign-up, then signs it in directly', async () => {
    vkProfile = {
      user_id: '777',
      first_name: 'Сергей',
      last_name: 'Петров',
      birthday: '12.03.1968',
      email: 'serg@example.ru',
    };
    const callback = await finishFlow(await startFlow());
    const location = callback.headers.location as string;
    expect(location).toMatch(new RegExp(`^${APP_BASE_URL}/signup/complete#token=`));
    const token = location.split('#token=')[1]!;
    const pending = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/oauth/pending',
      payload: { token },
    });
    expect(pending.json()).toEqual({
      provider: 'vk',
      email: 'serg@example.ru',
      displayName: 'Сергей Петров',
      birthdate: '1968-03-12',
    });
    const complete = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/oauth/complete',
      remoteAddress: nextIp(),
      payload: {
        token,
        displayName: 'Сергей Петров',
        username: 'sergey_p',
        birthdate: '1968-03-12',
        inviteCode: await invite(),
        ...LEGAL,
      },
    });
    expect(complete.statusCode).toBe(201);
    // Provider emails are not trusted as verified (ADR-011); a verification email goes out.
    expect(complete.json().user).toMatchObject({ emailVerified: false, hasPassword: false });

    const again = await finishFlow(await startFlow());
    expect(again.headers.location).toBe(`${APP_BASE_URL}/`);
    expect(cookieValue(again.headers['set-cookie'], RT)).toHaveLength(43);
  });

  it('never links by email alone', async () => {
    const { body } = await register();
    vkProfile = { user_id: '888', first_name: 'A', last_name: 'B', email: body.email };
    const callback = await finishFlow(await startFlow());
    expect(callback.headers.location).toBe(`${APP_BASE_URL}/login#oauthError=account_exists`);
  });

  it('links to the signed-in account identified by the refresh cookie', async () => {
    const { res } = await register();
    vkProfile = { user_id: '999', first_name: 'C', last_name: 'D' };
    const cookie = `${RT}=${cookieValue(res.headers['set-cookie'], RT)}`;
    const start = await startFlow('link', cookie);
    const callback = await finishFlow(start);
    expect(callback.headers.location).toBe(`${APP_BASE_URL}/settings/security#linked=vk`);
    const providers = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/providers',
      headers: { authorization: `Bearer ${res.json().accessToken}` },
    });
    expect(providers.json().data).toEqual([{ provider: 'vk', linkedAt: expect.any(String) }]);
    expect(
      fake.requests.some((r) => r.path === '/vk/token' && r.body.includes('device_id=dev-1')),
    ).toBe(true);
  });
});

describe('public config', () => {
  it('reports registration mode, providers and legal versions', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/config/public' });
    expect(res.json()).toEqual({
      registration: 'invite_only',
      oauthProviders: ['vk'],
      legalVersions: { terms: '2026-10-01', privacy: '2026-10-01', pdProcessing: '2026-10-01' },
    });
  });
});
