import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { cellDecision, POLICY_MATRIX, policyCell } from '@elega/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Invites } from '../src/modules/auth/index.js';
import { getDb } from './db.js';
import { APP_BASE_URL, buildApp, cookieValue, type Infra, startInfra } from './harness.js';

/**
 * Brief §29.3: one test per cell of the policy matrix (packages/shared/src/policy/matrix.ts).
 * Rows are bound to real requests from the milestone that ships their resource; the rest are
 * listed as pending so the report shows what is not enforced yet.
 */
const ENFORCED = new Set(['M0', 'M1']);
const RT = '__Host-elega_rt';
const PASSWORD = 'correct horse battery staple';

let infra: Infra;
let app: NestFastifyApplication;
let counter = 0;

beforeAll(async () => {
  infra = await startInfra();
  app = await buildApp();
});

afterAll(async () => {
  await app?.close();
  await infra?.stop();
});

interface Principal {
  accessToken: string | null;
  refreshToken: string | null;
}

async function signUp(role: 'user' | 'admin' = 'user'): Promise<Principal> {
  counter += 1;
  const email = `policy${counter}@example.ru`;
  const register = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    remoteAddress: `10.20.0.${counter}`,
    payload: {
      email,
      password: PASSWORD,
      displayName: `Policy ${counter}`,
      username: `policy_${counter}`,
      birthdate: '1990-05-05',
      inviteCode: await app.get(Invites, { strict: false }).create(getDb(infra), {}),
      acceptedTermsVersion: '2026-10-01',
      acceptedPrivacyVersion: '2026-10-01',
      acceptedPdProcessingVersion: '2026-10-01',
    },
  });
  expect(register.statusCode).toBe(201);
  if (role !== 'user') {
    await infra.pool.query('UPDATE users SET role = $1 WHERE email = $2', [role, email]);
  }
  // Sign in again so the access token carries the role.
  const login = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    remoteAddress: `10.21.0.${counter}`,
    payload: { identifier: email, password: PASSWORD },
  });
  expect(login.statusCode).toBe(200);
  return {
    accessToken: login.json<{ accessToken: string }>().accessToken,
    refreshToken: cookieValue(login.headers['set-cookie'], RT) ?? null,
  };
}

function call(
  principal: Principal,
  method: 'GET' | 'PATCH' | 'DELETE',
  url: string,
  payload?: object,
) {
  return app.inject({
    method,
    url,
    ...(payload ? { payload } : {}),
    headers: principal.accessToken ? { authorization: `Bearer ${principal.accessToken}` } : {},
  });
}

async function sessionIds(principal: Principal): Promise<string[]> {
  const res = await call(principal, 'GET', '/api/v1/auth/sessions');
  return res.json<{ data: Array<{ id: string }> }>().data.map((session) => session.id);
}

async function stillSignedIn(principal: Principal): Promise<boolean> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/refresh',
    headers: {
      'x-elega-csrf': '1',
      origin: APP_BASE_URL,
      cookie: `${RT}=${principal.refreshToken}`,
    },
  });
  if (res.statusCode !== 200) return false;
  principal.refreshToken = cookieValue(res.headers['set-cookie'], RT) ?? null;
  return true;
}

/**
 * Builds the viewer for a matrix column. Relationships ship in M3, so until then friend, fof,
 * follower and blocked are, as far as the API can tell, strangers: their cells for M1 rows
 * are the same `N`, which this test checks against the matrix rather than assuming.
 */
async function actor(column: string): Promise<Principal> {
  if (column === 'anon') return { accessToken: null, refreshToken: null };
  if (column === 'staff') return signUp('admin');
  return signUp();
}

type Check = (viewer: Principal, owner: Principal, column: string) => Promise<void>;

/** Request bindings for the rows enforced so far, as allow/deny pairs. */
const BINDINGS: Record<string, { allowed: Check; denied: Check }> = {
  'profiles/Sessions, settings, export, delete': {
    async allowed(viewer) {
      const ids = await sessionIds(viewer);
      expect(ids.length).toBeGreaterThan(0);
      expect((await call(viewer, 'GET', '/api/v1/me/settings')).statusCode).toBe(200);
      const patch = await call(viewer, 'PATCH', '/api/v1/me/settings', { dataSaver: true });
      expect(patch.statusCode).toBe(200);
    },
    async denied(viewer, owner, column) {
      const ownerSessions = await sessionIds(owner);
      if (column === 'anon') {
        expect((await call(viewer, 'GET', '/api/v1/auth/sessions')).statusCode).toBe(401);
        expect((await call(viewer, 'GET', '/api/v1/me/settings')).statusCode).toBe(401);
        expect(
          (await call(viewer, 'PATCH', '/api/v1/me/settings', { dataSaver: true })).statusCode,
        ).toBe(401);
        expect(
          (await call(viewer, 'DELETE', `/api/v1/auth/sessions/${ownerSessions[0]}`)).statusCode,
        ).toBe(401);
      } else {
        // Account routes are scoped to the caller: another user's session id is just not found.
        const res = await call(viewer, 'DELETE', `/api/v1/auth/sessions/${ownerSessions[0]}`);
        expect(res.statusCode).toBe(404);
        expect(await sessionIds(viewer)).not.toEqual(expect.arrayContaining([ownerSessions[0]]));
      }
      expect(await stillSignedIn(owner)).toBe(true);
    },
  },
};

describe('authorization matrix', () => {
  for (const table of POLICY_MATRIX) {
    describe(table.title, () => {
      for (const row of table.rows) {
        const binding = BINDINGS[`${table.id}/${row.action}`];
        if (!ENFORCED.has(row.milestone)) {
          it.todo(`${row.action} (from ${row.milestone})`);
          continue;
        }
        it(`binds every enforced row: ${row.action}`, () => {
          expect(binding, `no request binding for ${table.id} / ${row.action}`).toBeDefined();
        });
        if (!binding) continue;
        for (const column of table.actors) {
          const cell = policyCell(table.id, row.action, column);
          const decision = cellDecision(cell);
          if (decision === '—') continue;
          it(`${row.action} · ${column} → ${cell}`, async () => {
            expect(['Y', 'N'], 'M1 rows have no audience-dependent cells').toContain(decision);
            const owner = await signUp();
            const viewer = column === 'owner' ? owner : await actor(column);
            await (decision === 'Y'
              ? binding.allowed(viewer, owner, column)
              : binding.denied(viewer, owner, column));
          });
        }
      }
    });
  }
});
