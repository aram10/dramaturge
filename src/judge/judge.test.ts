// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Alex Rambasek

import { describe, expect, it, vi } from 'vitest';
import { judgeWorkerObservations } from './judge.js';

describe('judgeWorkerObservations', () => {
  it('turns observations into judged findings with trace-backed repro data', async () => {
    const evidence = [
      {
        id: 'ev-1',
        type: 'screenshot' as const,
        summary: 'Create button state',
        timestamp: '2026-03-30T12:00:00Z',
        areaName: 'Knowledge bases',
        relatedFindingIds: ['obs-1'],
      },
    ];

    const findings = await judgeWorkerObservations({
      observations: [
        {
          id: 'obs-1',
          category: 'Bug',
          severity: 'Major',
          title: 'Create button stops responding',
          stepsToReproduce: ['Open the page', 'Click Create'],
          expected: 'A dialog opens',
          actual: 'Nothing happens',
          evidenceIds: ['ev-1'],
          route: 'https://example.com/manage/knowledge-bases',
          objective: 'Validate knowledge base creation',
          breadcrumbs: ['click create button -> worked'],
          actionIds: ['act-1'],
        },
      ],
      evidence,
      actions: [
        {
          id: 'act-1',
          kind: 'click',
          summary: 'click create button -> worked',
          source: 'worker-tool',
          status: 'worked',
          timestamp: '2026-03-30T12:00:00Z',
        },
      ],
      config: {
        enabled: true,
        requestTimeoutMs: 10_000,
      },
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.verdict?.hypothesis).toContain('should');
    expect(findings[0]?.meta?.source).toBe('agent');
    expect(findings[0]?.meta?.repro?.actionIds).toEqual(['act-1']);
    expect(findings[0]?.meta?.repro?.evidenceIds).toEqual(['ev-1']);
    expect(evidence[0]?.relatedFindingIds[0]).toMatch(/^fid-/);
  });

  it('falls back to deterministic judgment when a custom judge throws', async () => {
    const findings = await judgeWorkerObservations({
      observations: [
        {
          id: 'obs-2',
          category: 'Bug',
          severity: 'Major',
          title: 'Save button never completes',
          stepsToReproduce: ['Open the page', 'Click Save'],
          expected: 'A success toast appears',
          actual: 'The spinner never stops',
          evidenceIds: [],
          route: 'https://example.com/settings',
          objective: 'Validate settings save',
          breadcrumbs: [],
          actionIds: [],
        },
      ],
      evidence: [],
      actions: [],
      config: {
        enabled: true,
        requestTimeoutMs: 10_000,
      },
      judgeText: vi.fn().mockRejectedValue(new Error('judge timeout')),
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.verdict?.alternativesConsidered).toContain(
      'Judge fallback used because the preferred judgment path failed.'
    );
  });

  it('skips LLM judge when deterministic graders are fully confident', async () => {
    const judgeText = vi.fn();

    const evidence = [
      {
        id: 'ev-1',
        type: 'console-error' as const,
        summary: 'Console error captured',
        timestamp: '2026-03-30T12:00:00Z',
        relatedFindingIds: ['obs-3'],
      },
      {
        id: 'ev-2',
        type: 'network-error' as const,
        summary: 'Network error captured',
        timestamp: '2026-03-30T12:00:01Z',
        relatedFindingIds: ['obs-3'],
      },
    ];

    const findings = await judgeWorkerObservations({
      observations: [
        {
          id: 'obs-3',
          category: 'Bug',
          severity: 'Major',
          title: 'Page crashes with errors',
          stepsToReproduce: ['Load the page'],
          expected: 'Page loads cleanly',
          actual: 'Console and network errors appear',
          evidenceIds: ['ev-1', 'ev-2'],
          route: '/dashboard',
          objective: 'Test page load',
          breadcrumbs: [],
          actionIds: [],
        },
      ],
      evidence,
      actions: [],
      config: { enabled: true, requestTimeoutMs: 10_000 },
      judgeText,
    });

    // All three graders give high confidence → LLM judge should be skipped
    expect(judgeText).not.toHaveBeenCalled();
    expect(findings).toHaveLength(1);
    expect(findings[0]?.meta?.confidence).toBe('high');
  });

  it('calls LLM judge when deterministic graders do not fully confirm', async () => {
    const judgeText = vi.fn().mockResolvedValue({
      hypothesis: 'The form should submit successfully',
      observation: 'Form submission failed',
      alternativesConsidered: ['LLM considered alternatives'],
      suggestedVerification: ['Try submitting again'],
      confidence: 'high',
    });

    const findings = await judgeWorkerObservations({
      observations: [
        {
          id: 'obs-4',
          category: 'Bug',
          severity: 'Major',
          title: 'Form fails silently',
          stepsToReproduce: ['Fill form', 'Click submit'],
          expected: 'Success message',
          actual: 'Nothing happens',
          evidenceIds: [],
          route: '/form',
          objective: 'Test form submission',
          breadcrumbs: [],
          actionIds: [],
        },
      ],
      evidence: [],
      actions: [],
      config: { enabled: true, requestTimeoutMs: 10_000 },
      judgeText,
    });

    // No evidence → graders give low confidence → LLM judge should be called
    expect(judgeText).toHaveBeenCalled();
    expect(findings).toHaveLength(1);
    // Grader notes should be appended to LLM decision
    expect(
      findings[0]?.verdict?.alternativesConsidered.some((a: string) =>
        a.includes('Deterministic grader')
      )
    ).toBe(true);
  });
});
