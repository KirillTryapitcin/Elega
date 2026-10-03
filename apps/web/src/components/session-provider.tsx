'use client';

import { useEffect, useSyncExternalStore, type ReactNode } from 'react';
import { refreshSession, sessionStore } from '@/lib/session';

const serverState = { accessToken: null, expiresAt: 0, user: null, status: 'loading' as const };

/** Restores the session from the refresh cookie once per page load. */
export function SessionProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    if (sessionStore.get().status === 'loading') void refreshSession();
  }, []);
  return children;
}

export function useSession() {
  return useSyncExternalStore(sessionStore.subscribe, sessionStore.get, () => serverState);
}
