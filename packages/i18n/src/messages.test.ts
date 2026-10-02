import { readFileSync } from 'node:fs';
import { IntlMessageFormat } from 'intl-messageformat';
import { describe, expect, it } from 'vitest';
import { LOCALES } from './index.js';

type Tree = { [key: string]: string | Tree };

function load(locale: string): Tree {
  return JSON.parse(
    readFileSync(new URL(`../messages/${locale}.json`, import.meta.url), 'utf8'),
  ) as Tree;
}

function flatten(tree: Tree, prefix = ''): Record<string, string> {
  return Object.entries(tree).reduce<Record<string, string>>((acc, [key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return typeof value === 'string'
      ? { ...acc, [path]: value }
      : { ...acc, ...flatten(value, path) };
  }, {});
}

const catalogs = Object.fromEntries(LOCALES.map((l) => [l, flatten(load(l))]));

describe('message catalogs', () => {
  it('every locale has the same keys as ru', () => {
    const ruKeys = Object.keys(catalogs['ru'] ?? {}).sort();
    for (const locale of LOCALES) {
      expect(Object.keys(catalogs[locale] ?? {}).sort(), locale).toEqual(ruKeys);
    }
  });

  it('every message is valid ICU', () => {
    for (const locale of LOCALES) {
      for (const [key, message] of Object.entries(catalogs[locale] ?? {})) {
        expect(() => new IntlMessageFormat(message, locale), `${locale}:${key}`).not.toThrow();
      }
    }
  });

  it('Russian plurals use one/few/many forms', () => {
    const friends = new IntlMessageFormat(catalogs['ru']?.['home.friends'] ?? '', 'ru');
    expect([1, 2, 5, 11, 21, 22, 25].map((count) => friends.format({ count }))).toEqual([
      '1 друг',
      '2 друга',
      '5 друзей',
      '11 друзей',
      '21 друг',
      '22 друга',
      '25 друзей',
    ]);
    const posts = new IntlMessageFormat(catalogs['ru']?.['home.newPosts'] ?? '', 'ru');
    expect(posts.format({ count: 0 })).toBe('Новых записей нет');
    expect(posts.format({ count: 1.5 })).toBe('1,5 новой записи');
  });
});
