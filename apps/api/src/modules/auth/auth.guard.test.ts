import { createPrivateKey } from 'node:crypto';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { decodeJwt, SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import { createKeyring } from '../../platform/crypto.js';
import { AppError } from '../../platform/errors/app-error.js';
import {
  type AuthUser,
  optionalUser,
  Public,
  RequireVerifiedEmail,
} from '../../platform/request-context.js';
import { AccessTokens } from './access-tokens.js';
import { AuthGuard } from './auth.guard.js';
import type { SessionsService } from './sessions.service.js';

const keyring = createKeyring({
  APP_SECRET: 'unit-test-secret-0123456789abcdef0123',
  AUTH_JWT_KEYS: undefined,
  AUTH_TOTP_KEYS: undefined,
});
const tokens = new AccessTokens(keyring);
const revoked = new Set<string>();
const sessions = { isDenied: async (id: string) => revoked.has(id) } as unknown as SessionsService;
const guard = new AuthGuard(new Reflector(), tokens, sessions);

const verified: AuthUser = {
  id: '0190f5c0-0000-7000-8000-000000000001',
  sessionId: '0190f5c0-0000-7000-8000-0000000000a1',
  role: 'user',
  minor: false,
  emailVerified: true,
};
const unverified: AuthUser = {
  ...verified,
  sessionId: '0190f5c0-0000-7000-8000-0000000000a2',
  emailVerified: false,
};

class Routes {
  @Public()
  profile() {}

  @RequireVerifiedEmail()
  upload() {}

  me() {}
}

type Request = Pick<FastifyRequest, 'headers' | 'authUser' | 'bearerRejected'>;

async function run(handler: keyof Routes, authorization?: string) {
  const request: Request = { headers: authorization === undefined ? {} : { authorization } };
  const context = {
    getHandler: () => Routes.prototype[handler],
    getClass: () => Routes,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  try {
    return { allowed: await guard.canActivate(context), request };
  } catch (error) {
    return { error: error as AppError, request };
  }
}

const bearer = async (user: AuthUser) => `Bearer ${await tokens.sign(user)}`;

describe('AuthGuard on public routes', () => {
  it('treats a request without a bearer as anonymous', async () => {
    const { allowed, request } = await run('profile');
    expect(allowed).toBe(true);
    expect(optionalUser(request)).toBeNull();
  });

  it('attaches a valid caller', async () => {
    const { allowed, request } = await run('profile', await bearer(verified));
    expect(allowed).toBe(true);
    expect(optionalUser(request)).toEqual(verified);
  });

  it('lets the route answer but makes OptionalUser a 401 for a bad, revoked or malformed bearer', async () => {
    const forged = `${(await bearer(verified)).slice(0, -4)}AAAA`;
    revoked.add('0190f5c0-0000-7000-8000-0000000000ff');
    const revokedToken = await bearer({
      ...verified,
      sessionId: '0190f5c0-0000-7000-8000-0000000000ff',
    });
    for (const header of [forged, revokedToken, 'Bearer ', 'Basic dXNlcjpwYXNz']) {
      const { allowed, request } = await run('profile', header);
      expect(allowed, header).toBe(true);
      expect(request.authUser).toBeUndefined();
      expect(() => optionalUser(request)).toThrow(
        expect.objectContaining({ code: 'unauthorized' }),
      );
    }
  });
});

describe('AuthGuard on protected routes', () => {
  it('requires a valid bearer', async () => {
    expect((await run('me')).error?.code).toBe('unauthorized');
    expect((await run('me', 'Bearer nonsense')).error?.code).toBe('unauthorized');
    expect((await run('me', await bearer(unverified))).allowed).toBe(true);
  });

  it('requires a verified email where marked, from the ev claim', async () => {
    expect((await run('upload', await bearer(verified))).allowed).toBe(true);
    const { error } = await run('upload', await bearer(unverified));
    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({
      code: 'forbidden',
      status: 403,
      details: [{ message: 'email_not_verified' }],
    });
    expect((await run('upload')).error?.code).toBe('unauthorized');
  });
});

describe('AccessTokens', () => {
  it('carries the email verification state in the ev claim', async () => {
    expect(decodeJwt(await tokens.sign(verified))).toMatchObject({ ev: true, minor: false });
    expect(decodeJwt(await tokens.sign(unverified))).toMatchObject({ ev: false });
    expect(await tokens.verify(await tokens.sign(unverified))).toEqual(unverified);
  });

  it('rejects tokens without ev (issued before M2), so clients refresh them', async () => {
    const [key] = keyring.jwt;
    const privateKey = createPrivateKey({
      key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), key!.seed]),
      format: 'der',
      type: 'pkcs8',
    });
    const legacy = await new SignJWT({ sid: verified.sessionId, role: 'user', minor: false })
      .setProtectedHeader({ alg: 'EdDSA', kid: key!.id, typ: 'at+jwt' })
      .setIssuer('elega')
      .setAudience('elega-api')
      .setSubject(verified.id)
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(privateKey);
    expect(await tokens.verify(legacy)).toBeNull();
  });
});
