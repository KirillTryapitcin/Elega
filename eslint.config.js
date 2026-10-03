import js from '@eslint/js';
import nextPlugin from '@next/eslint-plugin-next';
import boundaries from 'eslint-plugin-boundaries';
import reactHooks from 'eslint-plugin-react-hooks';
import security from 'eslint-plugin-security';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/.next/**',
      '**/coverage/**',
      '**/storybook-static/**',
      '**/next-env.d.ts',
      'packages/api-client/src/schema.d.ts',
      'docs/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  security.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      'no-console': ['error', { allow: ['warn', 'error'] }],
      // Fires on every keyed lookup with a typed key; real injection paths are covered by
      // Zod validation at the edge and by review.
      'security/detect-object-injection': 'off',
    },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}', 'packages/ui/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    plugins: { '@next/next': nextPlugin },
    settings: { next: { rootDir: 'apps/web' } },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,
    },
  },
  {
    // Nest uses constructor injection; the API's DI tokens and decorators need runtime imports.
    files: ['apps/api/**/*.ts'],
    rules: { '@typescript-eslint/consistent-type-imports': 'off' },
  },
  {
    files: ['apps/api/src/db/migrate-cli.ts', '**/*.test.{ts,tsx}', '**/*.int.test.ts'],
    rules: {
      'no-console': 'off',
      'security/detect-non-literal-fs-filename': 'off',
      'security/detect-non-literal-regexp': 'off',
    },
  },
  {
    // Modular monolith (ADR-001): a module reaches another module only through its index.ts,
    // and platform code never depends on feature modules.
    files: ['apps/api/src/**/*.ts'],
    plugins: { boundaries },
    settings: {
      'import/resolver': { typescript: { project: 'apps/api/tsconfig.json' } },
      'boundaries/elements': [
        { type: 'api-module', pattern: 'apps/api/src/modules/*', capture: ['name'] },
        { type: 'api-platform', pattern: 'apps/api/src/platform' },
        { type: 'api-config', pattern: 'apps/api/src/config' },
        { type: 'api-db', pattern: 'apps/api/src/db' },
      ],
    },
    rules: {
      'boundaries/dependencies': [
        'error',
        {
          default: 'allow',
          policies: [
            {
              from: { element: { type: 'api-module' } },
              disallow: { to: { element: { type: 'api-module' } } },
            },
            {
              from: { element: { type: 'api-module' } },
              allow: { to: { element: { type: 'api-module', fileInternalPath: 'index.ts' } } },
            },
            {
              from: { element: { type: 'api-module' } },
              allow: {
                to: {
                  element: {
                    type: 'api-module',
                    captured: { name: '{{ from.element.captured.name }}' },
                  },
                },
              },
            },
            {
              from: { element: { type: ['api-platform', 'api-config', 'api-db'] } },
              disallow: { to: { element: { type: 'api-module' } } },
            },
          ],
        },
      ],
    },
  },
);
