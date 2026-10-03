import { defineConfig } from 'vitest/config';

/** Brief §29.1 / §34.3: authorization policies are covered 100 %. */
const FULL = { 100: true, perFile: true } as const;

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts'],
      thresholds: {
        'src/profiles.ts': FULL,
        'src/media.ts': FULL,
        'src/text.ts': FULL,
        'src/countries.ts': FULL,
        'src/policy/**': FULL,
      },
    },
  },
});
