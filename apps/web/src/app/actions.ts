'use server';

import { isLocale } from '@elega/i18n';
import { cookies } from 'next/headers';
import { isTheme, LOCALE_COOKIE, THEME_COOKIE } from '@/i18n/locale';

const ONE_YEAR = 60 * 60 * 24 * 365;
const cookieOptions = {
  path: '/',
  maxAge: ONE_YEAR,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
};

export async function setLocale(value: string): Promise<void> {
  if (!isLocale(value)) return;
  (await cookies()).set(LOCALE_COOKIE, value, cookieOptions);
}

export async function setTheme(value: string): Promise<void> {
  if (!isTheme(value)) return;
  const store = await cookies();
  if (value === 'system') store.delete(THEME_COOKIE);
  else store.set(THEME_COOKIE, value, cookieOptions);
}
