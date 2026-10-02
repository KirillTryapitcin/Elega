'use client';

import { buttonVariants } from '@elega/ui';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/session';

export type Provider = 'vk' | 'yandex' | 'google';

/** Brand names differ by language ("Яндекс ID" / "Yandex ID"), so they live in the messages. */
export function useProviderName() {
  const t = useTranslations('auth.providers');
  return useCallback((provider: string) => (t.has(provider) ? t(provider) : provider), [t]);
}

export function usePublicConfig() {
  const [config, setConfig] = useState<{
    registration: 'invite_only' | 'open' | 'closed';
    oauthProviders: Provider[];
    legalVersions: { terms: string; privacy: string; pdProcessing: string };
  } | null>(null);
  useEffect(() => {
    void api()
      .GET('/config/public')
      .then(({ data }) => data && setConfig(data as NonNullable<typeof config>));
  }, []);
  return config;
}

/**
 * Plain links: OAuth starts with a top-level navigation so the provider can set its own
 * cookies and the API can bind the state to this browser.
 */
export function OAuthButtons({
  providers,
  intent = 'login',
}: {
  providers: Provider[];
  intent?: 'login' | 'link';
}) {
  const t = useTranslations('auth.oauth');
  const name = useProviderName();
  if (providers.length === 0) return null;
  return (
    <div className="grid gap-2">
      {providers.map((provider) => (
        <a
          key={provider}
          href={`/api/v1/auth/oauth/${provider}/start?intent=${intent}`}
          className={buttonVariants({ variant: 'outline', className: 'w-full' })}
        >
          {t(intent, { provider: name(provider) })}
        </a>
      ))}
    </div>
  );
}
