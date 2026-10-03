/**
 * Which authorization policy governs each route (ADR-013). Every route the API serves must have
 * an entry; `test/route-policies.int.test.ts` enumerates the registered routes and fails on a
 * route without one, on an entry naming a row that is not in the policy matrix
 * (`packages/shared/src/policy/matrix.ts`) and on an entry for an undocumented route. The
 * policy test (`test/policy.int.test.ts`) then checks each matrix cell against real requests.
 *
 * - `rows`: actions of matrix rows the route enforces (the first one decides access).
 * - `public`: no account needed and nothing owned by anyone else is exposed (health, sign-in).
 * - `self`: acts only on the caller's own account, which no matrix row restricts further.
 * - `staff`: moderator or admin tools (none before M11).
 *
 * Keys are `"<METHOD> <path>"` with the path relative to `/api/v1` and Fastify parameters.
 */
export type RoutePolicy =
  | { readonly rows: readonly [string, ...string[]] }
  | { readonly kind: 'public' | 'self' | 'staff' };

const PUBLIC = { kind: 'public' } as const;
const SELF = { kind: 'self' } as const;
const ACCOUNT = { rows: ['Sessions, settings, export, delete'] } as const;
const PROFILE_EDIT = { rows: ['Profile: edit'] } as const;
const OWN_MEDIA = { rows: ['Media: upload, status, delete own'] } as const;

export const ROUTE_POLICIES: Readonly<Record<string, RoutePolicy>> = {
  // Platform
  'GET /healthz': PUBLIC,
  'GET /readyz': PUBLIC,
  'GET /config/public': PUBLIC,

  // Sign-up and sign-in (M1)
  'POST /auth/register': PUBLIC,
  'POST /auth/verify-email': PUBLIC,
  'POST /auth/login': PUBLIC,
  'POST /auth/login/2fa': PUBLIC,
  'POST /auth/refresh': PUBLIC,
  'POST /auth/logout': PUBLIC,
  'POST /auth/forgot-password': PUBLIC,
  'POST /auth/reset-password': PUBLIC,
  'GET /auth/oauth/:provider/start': PUBLIC,
  'GET /auth/oauth/:provider/callback': PUBLIC,
  'POST /auth/oauth/pending': PUBLIC,
  'POST /auth/oauth/complete': PUBLIC,
  'POST /auth/resend-verification': SELF,

  // Account security, sessions and settings (M1)
  'POST /auth/logout-all': ACCOUNT,
  'POST /auth/change-password': ACCOUNT,
  'POST /auth/change-email': ACCOUNT,
  'POST /auth/2fa/setup': ACCOUNT,
  'POST /auth/2fa/confirm': ACCOUNT,
  'POST /auth/2fa/disable': ACCOUNT,
  'GET /auth/sessions': ACCOUNT,
  'DELETE /auth/sessions/:id': ACCOUNT,
  'GET /auth/providers': ACCOUNT,
  'DELETE /auth/providers/:provider': ACCOUNT,
  'GET /me/settings': ACCOUNT,
  'PATCH /me/settings': ACCOUNT,

  // Own profile (M2)
  'GET /me': SELF,
  'PATCH /me': PROFILE_EDIT,
  'POST /me/avatar': PROFILE_EDIT,
  'DELETE /me/avatar': PROFILE_EDIT,
  'POST /me/cover': PROFILE_EDIT,
  'DELETE /me/cover': PROFILE_EDIT,

  // Other people's profiles (M2)
  'GET /users/:usernameOrId': {
    rows: ['Profile: name, avatar, username', 'Profile: other fields'],
  },
  'GET /users/:id/photos': { rows: ['Profile: photos (avatar history)'] },

  // Media (M2)
  'POST /media/uploads': OWN_MEDIA,
  'POST /media/:id/complete': OWN_MEDIA,
  'GET /media/:id': OWN_MEDIA,
  'DELETE /media/:id': OWN_MEDIA,
};

/** The policy of a route, or undefined when it has none (a test failure, never a default). */
export function routePolicy(method: string, path: string): RoutePolicy | undefined {
  return ROUTE_POLICIES[`${method.toUpperCase()} ${path}`];
}
