// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Alex Rambasek

import { defineConfig } from 'vitest/config';
import { codecovVitePlugin } from '@codecov/vite-plugin';

export default defineConfig({
  plugins: [
    codecovVitePlugin({
      enableBundleAnalysis: !!process.env.CODECOV_TOKEN,
      bundleName: 'dramaturge',
      uploadToken: process.env.CODECOV_TOKEN,
      gitService: 'github',
    }),
  ],
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      reportsDirectory: 'coverage',
      include: ['src/**/*.ts', 'src/**/*.tsx'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/*.test.tsx',
        'src/adaptation/fixtures/**',
        'src/evals/**',
      ],
    },
  },
});
