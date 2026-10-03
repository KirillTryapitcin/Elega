import { cookies, headers } from 'next/headers';
import { getRequestConfig } from 'next-intl/server';
import { LOCALE_COOKIE, resolveLocale } from './locale';

const catalogs = {
  ru: () => import('@elega/i18n/messages/ru.json'),
  en: () => import('@elega/i18n/messages/en.json'),
};

export default getRequestConfig(async () => {
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);
  const locale = resolveLocale(
    cookieStore.get(LOCALE_COOKIE)?.value,
    headerStore.get('accept-language'),
  );
  return {
    locale,
    messages: (await catalogs[locale]()).default,
    timeZone: 'Europe/Moscow',
  };
});
