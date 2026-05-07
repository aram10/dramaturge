// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Alex Rambasek

import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettierConfig from 'eslint-config-prettier';

export default [
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  prettierConfig,
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'coverage/**',
      '*.config.js',
      'scripts/**',
      'action/**',
      'src/adaptation/fixtures/**',
    ],
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
    rules: {
      // Code quality rules
      '@typescript-eslint/no-unused-vars': [
        'warn', // Changed to warn to allow gradual cleanup
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      // Promoted to error — source files must not use `any`. Use unknown + narrowing, or a
      // typed interface. Inline suppressions (eslint-disable-next-line) are allowed when the
      // cast is genuinely necessary (e.g. Playwright/Stagehand event API surface).
      '@typescript-eslint/no-explicit-any': 'error',
      // Promoted to error — source files must not use non-null assertions (!). Use nullish
      // coalescing (??), optional chaining (?.), or explicit runtime checks instead.
      '@typescript-eslint/no-non-null-assertion': 'error',

      // Best practices
      'no-console': 'off', // We'll address this separately with a logger
      'no-debugger': 'error',
      'no-alert': 'error',
      'prefer-const': 'warn', // Changed to warn
      'no-var': 'error',

      // Anti-pattern prevention
      'max-params': ['warn', { max: 5 }], // Flag functions with > 5 params
      'max-lines-per-function': ['warn', { max: 150, skipBlankLines: true, skipComments: true }],
      complexity: ['warn', { max: 20 }],
      'max-depth': ['warn', { max: 4 }],
    },
  },
  {
    files: ['**/*.test.ts', '**/*.test.tsx'],
    rules: {
      '@typescript-eslint/no-unsafe-function-type': 'off', // Allow Function type in tests for mocking
      'max-lines-per-function': 'off', // Allow longer test functions
      // Test files routinely cast partial mocks with `as any` and use non-null assertions on
      // values known-safe at test-write time. Both are expected; the stricter source-file
      // settings are intentionally relaxed here.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
];
