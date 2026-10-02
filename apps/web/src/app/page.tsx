import type { Locale } from '@elega/i18n';
import { Badge, Card, CardDescription, CardTitle } from '@elega/ui';
import { cookies } from 'next/headers';
import { getLocale, getTranslations } from 'next-intl/server';
import { HomeSession } from '@/components/home-session';
import { Preferences } from '@/components/preferences';
import { isTheme, THEME_COOKIE } from '@/i18n/locale';

export default async function HomePage() {
  const t = await getTranslations();
  const locale = (await getLocale()) as Locale;
  const themeCookie = (await cookies()).get(THEME_COOKIE)?.value;

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center gap-6 px-4 py-12">
      <div className="flex items-center gap-3">
        <span className="text-2xl font-bold tracking-tight text-primary">
          {t('common.appName')}
        </span>
        <Badge tone="accent">alpha</Badge>
      </div>
      <Card className="space-y-3">
        <CardTitle className="text-2xl sm:text-3xl">{t('home.headline')}</CardTitle>
        <CardDescription className="text-base">{t('home.lead')}</CardDescription>
      </Card>
      <HomeSession />
      <Preferences locale={locale} theme={isTheme(themeCookie) ? themeCookie : 'system'} />
    </main>
  );
}
