// @ts-check
import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';

/** @type {import('eslint').Linter.Config[]} */
const config = [
  {
    ignores: [
      'node_modules/**',
      '.next/**',
      'out/**',
      'build/**',
      'dist/**',
      'coverage/**',
      'lib/db/migrations/**',
      'next-env.d.ts',
      '*.tsbuildinfo',
      'pnpm-lock.yaml',
    ],
  },
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    rules: {
      // App Router only — no `pages/` directory.
      '@next/next/no-html-link-for-pages': 'off',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'import/no-anonymous-default-export': 'off',
      '@typescript-eslint/consistent-type-imports': [
        'warn',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },
  {
    // CLI scripts (one-shot dev helpers) write to stdout intentionally.
    files: ['scripts/**/*.ts'],
    rules: {
      'no-console': 'off',
    },
  },
];

export default config;
