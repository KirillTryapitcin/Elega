import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

type Tree = { [key: string]: string | Tree };

const SRC = new URL('..', import.meta.url).pathname;
const ru = JSON.parse(
  readFileSync(new URL('../../../../packages/i18n/messages/ru.json', import.meta.url), 'utf8'),
) as Tree;

function lookup(path: string): string | Tree | undefined {
  return path
    .split('.')
    .reduce<string | Tree | undefined>(
      (node, part) => (node && typeof node === 'object' ? node[part] : undefined),
      ru,
    );
}

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.tsx?$/.test(entry.name) && !entry.name.endsWith('.test.ts') ? [path] : [];
  });
}

/**
 * Catalog parity is tested in @elega/i18n; this checks the other direction: every key the web
 * app asks for with a literal exists, so a typo fails CI instead of showing a raw key.
 */
describe('translation keys used by the web app', () => {
  const missing: string[] = [];
  for (const file of sources(SRC)) {
    const code = readFileSync(file, 'utf8');
    // A call belongs to the closest translator of that name declared above it, which matches
    // the one-translator-per-function style used here.
    const translators = [
      ...code.matchAll(
        // Runs over our own source files only, never over user input.
        // eslint-disable-next-line security/detect-unsafe-regex
        /const (\w+) = (?:await )?(?:useTranslations|getTranslations)\((?:'([\w.]+)')?\)/g,
      ),
    ].map((match) => ({
      name: match[1]!,
      prefix: match[2] ? `${match[2]}.` : '',
      at: match.index,
    }));
    const prefixFor = (name: string, at: number) =>
      translators.filter((item) => item.name === name && item.at < at).at(-1)?.prefix;

    for (const name of new Set(translators.map((item) => item.name))) {
      for (const match of code.matchAll(new RegExp(`\\b${name}(?:\\.rich)?\\('([\\w.]+)'`, 'g'))) {
        const prefix = prefixFor(name, match.index);
        const key = `${prefix ?? ''}${match[1]}`;
        if (prefix !== undefined && typeof lookup(key) !== 'string')
          missing.push(`${file}: ${key}`);
      }
      // Template keys such as t(`settings.privacy.${key}`): the fixed part must be a subtree.
      for (const match of code.matchAll(new RegExp(`\\b${name}\\(\`([\\w.]+)\\.\\$\\{`, 'g'))) {
        const prefix = prefixFor(name, match.index);
        const key = `${prefix ?? ''}${match[1]}`;
        if (prefix !== undefined && typeof lookup(key) !== 'object')
          missing.push(`${file}: ${key}.*`);
      }
    }
  }

  it('exist in the Russian catalog', () => {
    expect(missing).toEqual([]);
  });
});
