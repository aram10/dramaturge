import { describe, expect, it } from 'vitest';
import { buildAgentFindingMeta, buildAutoCaptureFindingMeta } from './repro.js';
import { renderJson } from '../report/json.js';
import type { AreaResult, RunResult } from '../types.js';

describe('repro helpers', () => {
  it('builds agent finding metadata with repro breadcrumbs and evidence ids', () => {
    const meta = buildAgentFindingMeta({
      stateId: 'node-1',
      route: 'https://example.com/manage/knowledge-bases',
      objective: 'Validate knowledge base creation',
      breadcrumbs: ['click create button -> worked', 'submit knowledge base form -> worked'],
      actionIds: ['act-1', 'act-2'],
      evidenceIds: ['ev-1'],
    });

    expect(meta).toMatchObject({
      source: 'agent',
      confidence: 'medium',
      repro: {
        stateId: 'node-1',
        route: 'https://example.com/manage/knowledge-bases',
        objective: 'Validate knowledge base creation',
        breadcrumbs: ['click create button -> worked', 'submit knowledge base form -> worked'],
        actionIds: ['act-1', 'act-2'],
        evidenceIds: ['ev-1'],
      },
    });
  });

  it('builds auto-capture metadata with explicit confidence', () => {
    const meta = buildAutoCaptureFindingMeta({
      route: 'https://example.com/api/manage/knowledge-bases',
      objective: 'Observe auto-captured browser failure',
      confidence: 'high',
      evidenceIds: ['ev-2'],
    });

    expect(meta).toMatchObject({
      source: 'auto-capture',
      confidence: 'high',
      repro: {
        objective: 'Observe auto-captured browser failure',
        evidenceIds: ['ev-2'],
      },
    });
  });
});

describe('renderJson repro metadata', () => {
  it('includes finding meta and repro artifacts in the JSON report', () => {
    const areaResult: AreaResult = {
      name: 'Knowledge bases',
      url: 'https://example.com/manage/knowledge-bases',
      steps: 2,
      findings: [
        {
          category: 'Bug',
          severity: 'Major',
          title: 'Create button stops responding',
          stepsToReproduce: ['Open the page', 'Click Create'],
          expected: 'A dialog opens',
          actual: 'Nothing happens',
          evidenceIds: ['ev-1'],
          meta: buildAgentFindingMeta({
            stateId: 'node-1',
            route: 'https://example.com/manage/knowledge-bases',
            objective: 'Validate knowledge base creation',
            breadcrumbs: ['click create button -> worked'],
            actionIds: ['act-1'],
            evidenceIds: ['ev-1'],
          }),
        },
      ],
      screenshots: new Map(),
      evidence: [],
      coverage: { controlsDiscovered: 1, controlsExercised: 1, events: [] },
      pageType: 'list',
      status: 'explored',
    };

    const runResult: RunResult = {
      targetUrl: 'https://example.com',
      startTime: new Date('2026-03-27T10:00:00Z'),
      endTime: new Date('2026-03-27T10:05:00Z'),
      areaResults: [areaResult],
      unexploredAreas: [],
      partial: false,
      blindSpots: [],
    };

    const rendered = JSON.parse(renderJson(runResult));

    expect(rendered.findings[0].meta).toMatchObject({
      source: 'agent',
      confidence: 'medium',
      repro: {
        stateId: 'node-1',
        route: 'https://example.com/manage/knowledge-bases',
        objective: 'Validate knowledge base creation',
        breadcrumbs: ['click create button -> worked'],
        actionIds: ['act-1'],
        evidenceIds: ['ev-1'],
      },
    });
  });
});
