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
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-non-null-assertion': 'warn',

      // Best practices
      'no-console': 'off', // We'll address this separately with a logger
      'no-debugger': 'error',
      'no-alert': 'error',
      'prefer-const': 'warn', // Changed to warn
      'no-var': 'error',

      // Anti-pattern prevention
      'max-params': ['warn', { max: 5 }], // Flag functions with > 5 params
      'max-lines-per-function': ['warn', { max: 150, skipBlankLines: true, skipComments: true }],
      'complexity': ['warn', { max: 20 }],
      'max-depth': ['warn', { max: 4 }],
    },
  },
  {
    files: ['**/*.test.ts', '**/*.test.tsx'],
    rules: {
      '@typescript-eslint/no-unsafe-function-type': 'off', // Allow Function type in tests for mocking
      'max-lines-per-function': 'off', // Allow longer test functions
    },
  },
];
