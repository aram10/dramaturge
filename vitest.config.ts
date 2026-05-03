// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Alex Rambasek

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      reportsDirectory: 'coverage',
      enabled: true,
      include: ['src/**/*.ts', 'src/**/*.tsx'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/*.test.tsx',
        'src/adaptation/fixtures/**',
        'src/evals/**',
      ],
      thresholds: {
        statements: 80,
        branches: 65,
        functions: 75,
        lines: 80,

        // Operationally critical paths: keep explicit baselines per-module.
        'src/engine.ts': {
          statements: 30,
          branches: 20,
          functions: 25,
          lines: 30,
        },
        'src/worker/worker.ts': {
          statements: 48,
          branches: 40,
          functions: 70,
          lines: 48,
        },
        'src/auth/authenticator.ts': {
          statements: 1,
          branches: 1,
          functions: 1,
          lines: 1,
        },
        'src/auth/none.ts': {
          statements: 1,
          branches: 1,
          functions: 1,
          lines: 1,
        },
        'src/auth/stored-state.ts': {
          statements: 1,
          branches: 1,
          functions: 1,
          lines: 1,
        },
        'src/dashboard/app.tsx': {
          statements: 0,
          branches: 0,
          functions: 0,
          lines: 0,
        },
      },
    },
  },
});
