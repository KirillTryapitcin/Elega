import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// SWC keeps the decorator metadata Nest's dependency injection needs.
export default defineConfig({
  plugins: [swc.vite({ tsconfigFile: './tsconfig.json' })],
  test: {
    projects: [
      { extends: true, test: { name: 'unit', include: ['src/**/*.test.ts'] } },
      {
        extends: true,
        test: {
          name: 'integration',
          include: ['test/**/*.int.test.ts'],
          testTimeout: 60_000,
          hookTimeout: 120_000,
        },
      },
    ],
  },
});
