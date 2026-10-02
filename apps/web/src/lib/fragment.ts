'use client';

import { useEffect, useMemo, useSyncExternalStore } from 'react';

/**
 * One-time secrets (email tokens, MFA challenges, OAuth results) arrive in the URL fragment,
 * which browsers never send to servers, so they stay out of access logs. Each page captures
 * the fragment once, then removes it from the address bar so a reload or a screenshot does
 * not leak it.
 */
let captured: { path: string; hash: string } | null = null;

function snapshot(): string {
  const path = window.location.pathname;
  if (captured?.path !== path) captured = { path, hash: window.location.hash.replace(/^#/, '') };
  return captured.hash;
}

const subscribe = () => () => {};

/** The fragment as captured on this page, or null while rendering on the server. */
export function useFragment(): URLSearchParams | null {
  const hash = useSyncExternalStore(subscribe, snapshot, () => null);
  useEffect(() => {
    if (hash)
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }, [hash]);
  return useMemo(() => (hash === null ? null : new URLSearchParams(hash)), [hash]);
}
