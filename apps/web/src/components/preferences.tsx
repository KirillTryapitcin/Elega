'use client';

import type { Locale } from '@elega/i18n';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { setLocale, setTheme } from '@/app/actions';
import type { Theme } from '@/i18n/locale';

const selectClass =
  'min-h-11 rounded-control border border-border bg-surface px-3 text-sm text-ink';

export function Preferences({ locale, theme }: { locale: Locale; theme: Theme }) {
  const t = useTranslations('common');
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const update = (action: (value: string) => Promise<void>, value: string) =>
    startTransition(async () => {
      await action(value);
      router.refresh();
    });

  return (
    <div className="flex flex-wrap items-center gap-3" aria-busy={pending}>
      <label className="flex items-center gap-2 text-sm text-muted">
        {t('theme.label')}
        <select
          className={selectClass}
          defaultValue={theme}
          onChange={(e) => update(setTheme, e.target.value)}
        >
          <option value="system">{t('theme.system')}</option>
          <option value="light">{t('theme.light')}</option>
          <option value="dark">{t('theme.dark')}</option>
        </select>
      </label>
      <label className="flex items-center gap-2 text-sm text-muted">
        {t('language')}
        <select
          className={selectClass}
          defaultValue={locale}
          onChange={(e) => update(setLocale, e.target.value)}
        >
          <option value="ru">Русский</option>
          <option value="en">English</option>
        </select>
      </label>
    </div>
  );
}
