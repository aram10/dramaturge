// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Alex Rambasek

import { describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildAreaResults, writeReports } from './reports.js';
import type { EngineContext } from './context.js';
import type { AreaResult, StateNode, RawFinding, Evidence, ReplayableAction } from '../types.js';

function makeNode(overrides: Partial<StateNode> = {}): StateNode {
  return {
    id: 'node-1',
    url: 'https://example.com/',
    title: 'Home',
    fingerprint: {
      normalizedPath: '/',
      signature: { pathname: '/', query: [], uiMarkers: [] },
      title: 'Home',
      heading: '',
      dialogTitles: [],
      hash: 'abc123',
    },
    pageType: 'landing',
    depth: 0,
    firstSeenAt: new Date().toISOString(),
    controlsDiscovered: ['btn-1', 'btn-2'],
    controlsExercised: ['btn-1'],
    tags: [],
    riskScore: 0,
    timesVisited: 3,
    ...overrides,
  };
}

function makeFinding(overrides: Partial<RawFinding> = {}): RawFinding {
  return {
    ref: 'fid-1',
    category: 'Bug',
    severity: 'Major',
    title: 'Button click fails',
    stepsToReproduce: ['Click button'],
    expected: 'Nothing',
    actual: 'Error',
    evidenceIds: [],
    ...overrides,
  };
}

function makeEvidence(overrides: Partial<Evidence> = {}): Evidence {
  return {
    id: 'ev-1',
    type: 'screenshot',
    summary: 'Screenshot of page',
    timestamp: new Date().toISOString(),
    areaName: 'Home',
    relatedFindingIds: [],
    ...overrides,
  };
}

function makeMinimalContext(
  nodes: StateNode[],
  findingsByNode: Map<string, RawFinding[]> = new Map(),
  evidenceByNode: Map<string, Evidence[]> = new Map(),
  actionsByNode: Map<string, ReplayableAction[]> = new Map()
): Pick<EngineContext, 'graph' | 'findingsByNode' | 'evidenceByNode' | 'actionsByNode'> {
  return {
    graph: {
      getAllNodes: () => nodes,
    } as EngineContext['graph'],
    findingsByNode,
    evidenceByNode,
    actionsByNode,
  };
}

describe('buildAreaResults', () => {
  it('returns results for visited nodes with findings', () => {
    const node = makeNode({ id: 'n1', timesVisited: 2 });
    const finding = makeFinding();
    const ctx = makeMinimalContext([node], new Map([['n1', [finding]]]));

    const results = buildAreaResults(ctx as EngineContext);

    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('Home');
    expect(results[0].url).toBe('https://example.com/');
    expect(results[0].steps).toBe(2);
    expect(results[0].findings).toEqual([finding]);
    expect(results[0].status).toBe('explored');
    expect(results[0].coverage.controlsDiscovered).toBe(2);
    expect(results[0].coverage.controlsExercised).toBe(1);
  });

  it('skips nodes with no visits, no findings, no evidence, no actions', () => {
    const node = makeNode({ id: 'n1', timesVisited: 0 });
    const ctx = makeMinimalContext([node]);

    const results = buildAreaResults(ctx as EngineContext);
    expect(results).toHaveLength(0);
  });

  it('includes unvisited nodes that have findings', () => {
    const node = makeNode({ id: 'n1', timesVisited: 0 });
    const finding = makeFinding();
    const ctx = makeMinimalContext([node], new Map([['n1', [finding]]]));

    const results = buildAreaResults(ctx as EngineContext);

    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('skipped');
    expect(results[0].findings).toEqual([finding]);
  });

  it('includes nodes with evidence but no findings', () => {
    const node = makeNode({ id: 'n1', timesVisited: 0 });
    const evidence = makeEvidence();
    const ctx = makeMinimalContext([node], new Map(), new Map([['n1', [evidence]]]));

    const results = buildAreaResults(ctx as EngineContext);

    expect(results).toHaveLength(1);
    expect(results[0].evidence).toEqual([evidence]);
  });

  it('includes nodes with replayable actions but no findings', () => {
    const node = makeNode({ id: 'n1', timesVisited: 0 });
    const action: ReplayableAction = {
      id: 'act-1',
      kind: 'click',
      summary: 'Click submit button',
      source: 'page',
      status: 'recorded',
      timestamp: new Date().toISOString(),
      selector: 'button.submit',
    };
    const ctx = makeMinimalContext([node], new Map(), new Map(), new Map([['n1', [action]]]));

    const results = buildAreaResults(ctx as EngineContext);

    expect(results).toHaveLength(1);
    expect(results[0].replayableActions).toEqual([action]);
  });

  it('falls back to pageType label when title is undefined', () => {
    const node = makeNode({ id: 'n1', title: undefined, pageType: 'form', timesVisited: 1 });
    const ctx = makeMinimalContext([node]);

    const results = buildAreaResults(ctx as EngineContext);

    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('form (n1)');
  });

  it('handles multiple nodes correctly', () => {
    const node1 = makeNode({ id: 'n1', title: 'Page A', timesVisited: 1 });
    const node2 = makeNode({ id: 'n2', title: 'Page B', timesVisited: 2 });
    const node3 = makeNode({ id: 'n3', title: 'Page C', timesVisited: 0 }); // skipped
    const finding = makeFinding();
    const ctx = makeMinimalContext([node1, node2, node3], new Map([['n2', [finding]]]));

    const results = buildAreaResults(ctx as EngineContext);

    expect(results).toHaveLength(2);
    expect(results[0].name).toBe('Page A');
    expect(results[1].name).toBe('Page B');
    expect(results[1].findings).toEqual([finding]);
  });

  it('returns empty array when graph has no nodes', () => {
    const ctx = makeMinimalContext([]);
    const results = buildAreaResults(ctx as EngineContext);
    expect(results).toEqual([]);
  });

  it('populates pageType and fingerprint from node', () => {
    const node = makeNode({ id: 'n1', pageType: 'dashboard', timesVisited: 1 });
    const ctx = makeMinimalContext([node]);

    const results = buildAreaResults(ctx as EngineContext);

    expect(results[0].pageType).toBe('dashboard');
    expect(results[0].fingerprint).toEqual(node.fingerprint);
  });
});

function makeAreaResultForReport(): AreaResult {
  const action: ReplayableAction = {
    id: 'act-1',
    kind: 'click',
    summary: 'Click submit button',
    source: 'page',
    status: 'recorded',
    timestamp: '2026-05-20T18:00:00.000Z',
    selector: 'button.submit',
  };
  return {
    name: 'Checkout',
    url: 'https://example.com/checkout',
    steps: 1,
    findings: [
      makeFinding({
        evidenceIds: ['ev-1'],
        meta: {
          source: 'agent',
          confidence: 'high',
          repro: {
            route: '/checkout',
            objective: 'Submit checkout form',
            breadcrumbs: ['checkout', 'submit'],
            actionIds: ['act-1'],
            evidenceIds: ['ev-1'],
          },
        },
      }),
    ],
    replayableActions: [action],
    screenshots: new Map(),
    evidence: [
      makeEvidence({
        id: 'ev-1',
        type: 'console-error',
        summary: 'Cannot read properties of null',
      }),
    ],
    coverage: { controlsDiscovered: 1, controlsExercised: 1, events: [] },
    pageType: 'form',
    status: 'explored',
  };
}

function makeReportContext(outputDir: string): EngineContext {
  return {
    outputDir,
    config: {
      targetUrl: 'https://example.com',
      appDescription: 'Example app',
      models: { planner: 'anthropic/test-planner', worker: 'anthropic/test-worker' },
      concurrency: { workers: 1 },
      budget: {
        globalTimeLimitSeconds: 60,
        maxStepsPerTask: 3,
        maxFrontierSize: 10,
        maxStateNodes: 10,
      },
      checkpoint: { intervalTasks: 0 },
      autoCapture: {
        consoleErrors: false,
        consoleWarnings: false,
        networkErrors: false,
      },
      memory: { enabled: false, warmStart: false },
      visualRegression: { enabled: false },
      output: { format: 'json' },
    },
    budget: {
      globalTimeLimitSeconds: 60,
      maxStepsPerTask: 3,
      maxFrontierSize: 10,
      maxStateNodes: 10,
    },
    globalCoverage: { getBlindSpots: () => [] },
    graph: { nodeCount: () => 0, toMermaid: () => '' },
    activeAuthProfile: 'admin',
    logger: { info: () => undefined },
  } as unknown as EngineContext;
}

describe('writeReports', () => {
  it('emits replay manifests alongside existing report artifacts', () => {
    const outputDir = mkdtempSync(join(tmpdir(), 'dramaturge-reports-'));
    try {
      writeReports(
        makeReportContext(outputDir),
        new Date('2026-05-20T18:00:00.000Z'),
        [makeAreaResultForReport()],
        []
      );

      const reportPath = join(outputDir, 'report.json');
      const manifestPath = join(outputDir, 'findings', 'BUG-001.json');
      expect(existsSync(reportPath)).toBe(true);
      expect(existsSync(manifestPath)).toBe(true);

      const report = JSON.parse(readFileSync(reportPath, 'utf-8')) as { findings: unknown[] };
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as {
        origin: { authProfile?: string };
        replay: { actions: ReplayableAction[] };
      };
      expect(report.findings).toHaveLength(1);
      expect(manifest.origin.authProfile).toBe('admin');
      expect(manifest.replay.actions.map((action) => action.id)).toEqual(['act-1']);
    } finally {
      rmSync(outputDir, { recursive: true, force: true });
    }
  });
});
