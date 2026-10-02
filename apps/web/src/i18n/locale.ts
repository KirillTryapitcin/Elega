import { DEFAULT_LOCALE, isLocale, type Locale } from '@elega/i18n';

export const LOCALE_COOKIE = 'NEXT_LOCALE';
export const THEME_COOKIE = 'elega_theme';
export const THEMES = ['light', 'dark', 'system'] as const;
export type Theme = (typeof THEMES)[number];

export function isTheme(value: string | undefined): value is Theme {
  return value !== undefined && (THEMES as readonly string[]).includes(value);
}

/** Picks the locale: explicit cookie first, then the best Accept-Language match, then Russian. */
export function resolveLocale(cookie: string | undefined, acceptLanguage: string | null): Locale {
  if (cookie && isLocale(cookie)) return cookie;
  const ranked = (acceptLanguage ?? '')
    .split(',')
    .map((part) => {
      const [tag = '', ...params] = part.trim().split(';');
      const q = Number(params.find((p) => p.trim().startsWith('q='))?.split('=')[1] ?? '1');
      return { lang: tag.toLowerCase().split('-')[0] ?? '', q: Number.isNaN(q) ? 0 : q };
    })
    .filter((entry) => entry.lang && entry.q > 0)
    .sort((a, b) => b.q - a.q);
  return ranked.map((entry) => entry.lang).find(isLocale) ?? DEFAULT_LOCALE;
}
