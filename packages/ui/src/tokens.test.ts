// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { contrast, palette, textPairs, type ThemeName } from './tokens';

const css = readFileSync(new URL('./theme.css', import.meta.url), 'utf8');
const kebab = (token: string) => token.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

describe('Dusk tokens', () => {
  for (const theme of Object.keys(palette) as ThemeName[]) {
    it(`${theme}: every text pair meets WCAG AA (4.5:1)`, () => {
      for (const [fg, bg] of textPairs) {
        const ratio = contrast(palette[theme][fg], palette[theme][bg]);
        expect(ratio, `${theme} ${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
      }
    });

    it(`${theme}: theme.css declares the same values`, () => {
      for (const [token, value] of Object.entries(palette[theme])) {
        expect(css, `${theme} --elega-${kebab(token)}`).toContain(
          `--elega-${kebab(token)}: ${value};`,
        );
      }
    });
  }
});
