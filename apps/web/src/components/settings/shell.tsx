'use client';

import { cn } from '@elega/ui';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { useSession } from '@/components/session-provider';

const TABS = [
  { href: '/settings', key: 'account' },
  { href: '/settings/security', key: 'security' },
  { href: '/settings/privacy', key: 'privacy' },
] as const;

/** Settings frame: tabs, and a redirect to sign-in for anonymous visitors. */
export function SettingsShell({ children }: { children: ReactNode }) {
  const t = useTranslations('settings');
  const tc = useTranslations('common');
  const pathname = usePathname();
  const router = useRouter();
  const session = useSession();

  useEffect(() => {
    if (session.status === 'anonymous') router.replace('/login');
  }, [session.status, router]);

  return (
    <main className="mx-auto w-full max-w-2xl space-y-6 px-4 py-8">
      <div className="flex items-center justify-between gap-3">
        <Link href="/" className="text-xl font-bold tracking-tight text-primary">
          {tc('appName')}
        </Link>
      </div>
      <h1 className="text-2xl font-bold text-ink">{t('title')}</h1>
      <nav
        aria-label={t('title')}
        className="flex gap-1 overflow-x-auto rounded-full bg-primary-soft p-1"
      >
        {TABS.map((tab) => {
          const active = pathname === tab.href;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'inline-flex min-h-10 flex-1 items-center justify-center rounded-full px-4 text-sm font-semibold whitespace-nowrap',
                active ? 'bg-surface text-ink shadow-card' : 'text-primary-ink hover:bg-surface/60',
              )}
            >
              {t(`tabs.${tab.key}`)}
            </Link>
          );
        })}
      </nav>
      {session.status === 'authenticated' && session.user ? (
        children
      ) : (
        <p className="text-sm text-muted">{tc('loading')}</p>
      )}
    </main>
  );
}

export function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-4 rounded-card border border-border bg-surface p-4 shadow-card sm:p-5">
      <div className="space-y-1">
        <h2 className="text-lg font-bold text-ink">{title}</h2>
        {description && <p className="text-sm text-muted">{description}</p>}
      </div>
      {children}
    </section>
  );
}
