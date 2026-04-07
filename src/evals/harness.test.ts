import { describe, expect, it } from 'vitest';
import { summarizeEvalResults } from './harness.js';

describe('summarizeEvalResults', () => {
  it('computes pass rate and failure breakdown from eval case results', () => {
    const summary = summarizeEvalResults([
      { id: 'api-contract-regression', passed: true, tags: ['api', 'oracle'] },
      {
        id: 'false-positive-trap',
        passed: false,
        tags: ['precision'],
        failureReason: 'reported a duplicate finding',
      },
      { id: 'visual-baseline', passed: true, tags: ['visual'] },
    ]);

    expect(summary).toEqual({
      total: 3,
      passed: 2,
      failed: 1,
      passRate: 2 / 3,
      failures: [
        {
          id: 'false-positive-trap',
          reason: 'reported a duplicate finding',
        },
      ],
      tagBreakdown: {
        api: { total: 1, passed: 1 },
        oracle: { total: 1, passed: 1 },
        precision: { total: 1, passed: 0 },
        visual: { total: 1, passed: 1 },
      },
    });
  });
});
