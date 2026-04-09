// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Alex Rambasek

import type { EvalCaseResult, EvalSummary } from './types.js';

export function summarizeEvalResults(results: EvalCaseResult[]): EvalSummary {
  const passed = results.filter((result) => result.passed).length;
  const failures = results
    .filter((result) => !result.passed)
    .map((result) => ({
      id: result.id,
      reason: result.failureReason ?? 'Unknown failure',
    }));

  const tagBreakdown = results.reduce<Record<string, { total: number; passed: number }>>(
    (acc, result) => {
      for (const tag of result.tags) {
        const existing = acc[tag] ?? { total: 0, passed: 0 };
        existing.total += 1;
        if (result.passed) {
          existing.passed += 1;
        }
        acc[tag] = existing;
      }
      return acc;
    },
    {}
  );

  return {
    total: results.length,
    passed,
    failed: results.length - passed,
    passRate: results.length === 0 ? 0 : passed / results.length,
    failures,
    tagBreakdown,
  };
}
