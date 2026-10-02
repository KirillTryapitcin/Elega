'use client';

import { type ApiClient, createApiClient, type Schemas } from '@elega/api-client';

export type Me = Schemas['Me'];
export type AuthResult = Schemas['AuthResult'];
export type ApiError = Schemas['Error']['error'];

/** Set by the API next to the HttpOnly refresh cookie; holds no secret (ADR-004). */
const HINT_COOKIE = '__Host-elega_signed_in';
const REFRESH_MARGIN_MS = 30_000;

interface State {
  accessToken: string | null;
  expiresAt: number;
  user: Me | null;
  status: 'loading' | 'authenticated' | 'anonymous';
}

let state: State = { accessToken: null, expiresAt: 0, user: null, status: 'loading' };
const listeners = new Set<() => void>();

function set(next: Partial<State>) {
  state = { ...state, ...next };
  for (const listener of listeners) listener();
}

export const sessionStore = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  get: () => state,
};

/** Keeps the access token in memory only (never localStorage), per ADR-004. */
export function acceptAuthResult(result: AuthResult) {
  set({
    accessToken: result.accessToken,
    expiresAt: Date.now() + result.expiresIn * 1000,
    user: result.user,
    status: 'authenticated',
  });
}

export function setUser(user: Me) {
  set({ user });
}

export function clearSession() {
  set({ accessToken: null, expiresAt: 0, user: null, status: 'anonymous' });
}

function hasHint() {
  return document.cookie.split('; ').some((pair) => pair.startsWith(`${HINT_COOKIE}=`));
}

let inflight: Promise<boolean> | null = null;

/**
 * Exchanges the refresh cookie for a new access token. Tabs take a Web Lock first: two tabs
 * presenting the same refresh token at once would look like token theft to the server.
 */
export function refreshSession(): Promise<boolean> {
  if (!hasHint()) {
    clearSession();
    return Promise.resolve(false);
  }
  inflight ??= (async () => {
    const run = async () => {
      const response = await fetch('/api/v1/auth/refresh', {
        method: 'POST',
        headers: { 'x-elega-csrf': '1' },
        credentials: 'same-origin',
      });
      if (!response.ok) {
        clearSession();
        return false;
      }
      acceptAuthResult((await response.json()) as AuthResult);
      return true;
    };
    try {
      return await (navigator.locks ? navigator.locks.request('elega-refresh', run) : run());
    } catch {
      clearSession();
      return false;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

async function ensureFreshToken(): Promise<string | null> {
  if (state.accessToken && state.expiresAt - Date.now() > REFRESH_MARGIN_MS)
    return state.accessToken;
  if (state.status === 'anonymous') return null;
  return (await refreshSession()) ? state.accessToken : null;
}

let client: ApiClient | null = null;

/** Typed client for /api/v1 that attaches the access token and refreshes it when due. */
export function api(): ApiClient {
  if (client) return client;
  client = createApiClient({ baseUrl: '/api/v1', credentials: 'same-origin' });
  client.use({
    async onRequest({ request }) {
      const path = new URL(request.url).pathname;
      if (path.endsWith('/auth/refresh')) return request;
      const token = await ensureFreshToken();
      if (token) request.headers.set('authorization', `Bearer ${token}`);
      if (path.endsWith('/auth/logout')) request.headers.set('x-elega-csrf', '1');
      return request;
    },
    onResponse({ response, request }) {
      // A revoked session: drop local state; the page decides where to send the user.
      if (response.status === 401 && request.headers.has('authorization')) clearSession();
      return response;
    },
  });
  return client;
}

export async function signOut() {
  await api().POST('/auth/logout', { params: { header: { 'X-Elega-CSRF': '1' } } });
  clearSession();
}
