'use client';

import { Button, buttonVariants, Card } from '@elega/ui';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useState } from 'react';
import { FormAlert } from '@/components/auth/parts';
import { useSession } from '@/components/session-provider';
import { api, signOut } from '@/lib/session';

/** Sign-in links for visitors; account summary and the unverified-email banner for members. */
export function HomeSession() {
  const t = useTranslations();
  const { status, user } = useSession();
  const [notice, setNotice] = useState<string | null>(null);

  if (status === 'loading') return <p className="text-sm text-muted">{t('common.loading')}</p>;

  if (status === 'anonymous' || !user) {
    return (
      <div className="flex flex-col gap-2 sm:flex-row">
        <Link href="/login" className={buttonVariants({ size: 'lg', className: 'flex-1' })}>
          {t('common.signIn')}
        </Link>
        <Link
          href="/signup"
          className={buttonVariants({ size: 'lg', variant: 'outline', className: 'flex-1' })}
        >
          {t('common.signUp')}
        </Link>
      </div>
    );
  }

  async function resend() {
    const { response } = await api().POST('/auth/resend-verification');
    setNotice(response.status === 202 ? t('settings.email.resent') : t('auth.errors.rate_limited'));
  }

  return (
    <Card className="space-y-4">
      {!user.emailVerified && (
        <div className="space-y-2 rounded-control border border-accent/40 bg-accent/10 p-3.5">
          <p className="text-sm text-ink">{t('home.verifyBanner', { email: user.email })}</p>
          <Button variant="soft" size="sm" onClick={() => void resend()}>
            {t('settings.email.resend')}
          </Button>
          <FormAlert tone="success" message={notice} />
        </div>
      )}
      <p className="text-ink" data-testid="signed-in-as">
        {t('home.signedInAs', { name: user.displayName, username: user.username })}
      </p>
      <div className="flex flex-wrap gap-2">
        <Link href="/settings" className={buttonVariants({ variant: 'outline' })}>
          {t('settings.title')}
        </Link>
        <Button variant="ghost" onClick={() => void signOut()}>
          {t('common.signOut')}
        </Button>
      </div>
    </Card>
  );
}
