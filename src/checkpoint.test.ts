import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { saveCheckpoint, loadCheckpoint, hydrateFromCheckpoint } from './checkpoint.js';
import { StateGraph } from './graph/state-graph.js';
import { FrontierQueue } from './graph/frontier.js';
import { CoverageTracker } from './coverage/tracker.js';
import type { RawFinding, Evidence, PageFingerprint, ReplayableAction } from './types.js';

function makeFP(hash: string): PageFingerprint {
  return {
    normalizedPath: '/',
    signature: {
      pathname: '/',
      query: [],
      uiMarkers: [],
    },
    title: 'T',
    heading: 'H',
    dialogTitles: [],
    hash,
  };
}

describe('Checkpoint', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `dramaturge-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('saveCheckpoint writes a valid JSON file', () => {
    const graph = new StateGraph();
    const node = graph.addNode({
      url: 'https://example.com',
      fingerprint: makeFP('abc123'),
      pageType: 'dashboard',
      depth: 0,
    });

    const frontier = new FrontierQueue();
    frontier.enqueue({
      id: 'task-1',
      nodeId: node.id,
      workerType: 'navigation',
      objective: 'Explore root',
      priority: 0.9,
      reason: 'auto',
      retryCount: 0,
      createdAt: new Date().toISOString(),
      status: 'pending',
    });

    const findings = new Map<string, RawFinding[]>();
    findings.set(node.id, [
      {
        category: 'Bug',
        severity: 'Major',
        title: 'Test bug',
        stepsToReproduce: ['step 1'],
        expected: 'works',
        actual: 'broken',
      },
    ]);

    const evidence = new Map<string, Evidence[]>();
    const actions = new Map<string, ReplayableAction[]>();
    const coverage = new CoverageTracker();

    saveCheckpoint(tmpDir, graph, frontier, findings, evidence, actions, coverage, ['task-0'], 5, {
      [node.id]: ['navigation'],
    });

    const cpPath = join(tmpDir, 'checkpoint.json');
    expect(existsSync(cpPath)).toBe(true);

    const raw = JSON.parse(readFileSync(cpPath, 'utf-8'));
    expect(raw.version).toBe(1);
    expect(raw.tasksExecuted).toBe(5);
    expect(raw.graphSnapshot.nodes).toHaveLength(1);
    expect(raw.completedTaskIds).toEqual(['task-0']);
    expect(raw.actionsByNode).toEqual({});
    expect(raw.plannerState).toEqual({
      [node.id]: ['navigation'],
    });
  });

  it('loadCheckpoint returns null for missing file', () => {
    expect(loadCheckpoint(tmpDir)).toBeNull();
  });

  it('loadCheckpoint reads a saved checkpoint', () => {
    const graph = new StateGraph();
    graph.addNode({
      fingerprint: makeFP('abc'),
      pageType: 'form',
      depth: 0,
    });

    const frontier = new FrontierQueue();
    const coverage = new CoverageTracker();
    const findings = new Map<string, RawFinding[]>();
    const evidence = new Map<string, Evidence[]>();
    const actions = new Map<string, ReplayableAction[]>();

    saveCheckpoint(tmpDir, graph, frontier, findings, evidence, actions, coverage, [], 0, {});

    const loaded = loadCheckpoint(tmpDir);
    expect(loaded).not.toBeNull();
    if (!loaded) {
      throw new Error('Expected checkpoint to load');
    }
    expect(loaded.version).toBe(1);
    expect(loaded.graphSnapshot.nodes).toHaveLength(1);
  });

  it('loadCheckpoint rejects structurally invalid checkpoint files', () => {
    const cpPath = join(tmpDir, 'checkpoint.json');
    const invalidCheckpoint = {
      version: 1,
      savedAt: new Date().toISOString(),
      tasksExecuted: 1,
      frontierSnapshot: [],
      findingsByNode: {},
      evidenceByNode: {},
      blindSpots: [],
      completedTaskIds: [],
    };

    writeFileSync(cpPath, JSON.stringify(invalidCheckpoint), 'utf-8');

    expect(() => loadCheckpoint(tmpDir)).toThrow(/Failed to parse or validate checkpoint JSON/);
  });

  it('hydrateFromCheckpoint restores graph, frontier, and findings', () => {
    // Create and save
    const origGraph = new StateGraph();
    const node = origGraph.addNode({
      url: 'https://example.com/page',
      fingerprint: makeFP('xyz'),
      pageType: 'list',
      depth: 1,
    });

    const origFrontier = new FrontierQueue();
    origFrontier.enqueue({
      id: 'task-5',
      nodeId: node.id,
      workerType: 'crud',
      objective: 'Test CRUD',
      priority: 0.7,
      reason: 'auto',
      retryCount: 0,
      createdAt: new Date().toISOString(),
      status: 'pending',
    });

    const findings = new Map<string, RawFinding[]>();
    findings.set(node.id, [
      {
        category: 'UX Concern',
        severity: 'Minor',
        title: 'Confusing label',
        stepsToReproduce: [],
        expected: 'clear',
        actual: 'confusing',
      },
    ]);

    const evidence = new Map<string, Evidence[]>();
    const actions = new Map<string, ReplayableAction[]>();
    actions.set(node.id, [
      {
        id: 'act-1',
        kind: 'click',
        selector: "button[data-testid='create']",
        summary: 'click create button -> worked',
        source: 'worker-tool',
        status: 'worked',
        timestamp: new Date().toISOString(),
      },
    ]);
    const coverage = new CoverageTracker();
    coverage.addBlindSpot({
      nodeId: node.id,
      summary: 'Not reached',
      reason: 'time-budget',
      severity: 'low',
    });

    saveCheckpoint(
      tmpDir,
      origGraph,
      origFrontier,
      findings,
      evidence,
      actions,
      coverage,
      ['task-1', 'task-2'],
      10,
      {
        [node.id]: ['crud', 'navigation'],
      }
    );

    // Load and hydrate into fresh structures
    const checkpoint = loadCheckpoint(tmpDir);
    if (!checkpoint) {
      throw new Error('Expected checkpoint to load');
    }
    const newGraph = new StateGraph();
    const newFrontier = new FrontierQueue();
    const newCoverage = new CoverageTracker();

    const result = hydrateFromCheckpoint(checkpoint, newGraph, newFrontier, newCoverage);

    expect(newGraph.nodeCount()).toBe(1);
    expect(newGraph.getNode(node.id).url).toBe('https://example.com/page');
    expect(newFrontier.size()).toBe(1);
    expect(result.findingsByNode.get(node.id)).toHaveLength(1);
    expect(result.actionsByNode.get(node.id)).toHaveLength(1);
    expect(result.completedTaskIds.size).toBe(2);
    expect(result.tasksExecuted).toBe(10);
    expect(result.plannerState).toEqual({
      [node.id]: ['crud', 'navigation'],
    });
    expect(newCoverage.getBlindSpots()).toHaveLength(1);
  });

  it('preserves pending frontier items when a final checkpoint is saved after report-time drain', () => {
    const graph = new StateGraph();
    const node = graph.addNode({
      url: 'https://example.com/page',
      fingerprint: makeFP('resume-root'),
      pageType: 'list',
      depth: 0,
    });

    const frontier = new FrontierQueue();
    frontier.enqueue({
      id: 'task-pending',
      nodeId: node.id,
      workerType: 'navigation',
      objective: 'Resume this task',
      priority: 0.9,
      reason: 'coverage',
      retryCount: 0,
      createdAt: new Date().toISOString(),
      status: 'pending',
    });
    frontier.enqueue({
      id: 'task-done',
      nodeId: node.id,
      workerType: 'crud',
      objective: 'Already completed task',
      priority: 0.2,
      reason: 'history',
      retryCount: 0,
      createdAt: new Date().toISOString(),
      status: 'completed',
    });

    const findings = new Map<string, RawFinding[]>();
    const evidence = new Map<string, Evidence[]>();
    const actions = new Map<string, ReplayableAction[]>();
    const coverage = new CoverageTracker();
    const resumableFrontierSnapshot = frontier.snapshot();

    frontier.drain();

    saveCheckpoint(
      tmpDir,
      graph,
      frontier,
      findings,
      evidence,
      actions,
      coverage,
      [],
      4,
      {},
      { frontierSnapshot: resumableFrontierSnapshot }
    );

    const loaded = loadCheckpoint(tmpDir);
    if (!loaded) {
      throw new Error('Expected checkpoint to load');
    }
    const restoredFrontier = new FrontierQueue();
    hydrateFromCheckpoint(loaded, new StateGraph(), restoredFrontier, new CoverageTracker());

    expect(loaded.frontierSnapshot.filter((item) => item.status === 'pending')).toHaveLength(1);
    expect(restoredFrontier.size()).toBe(1);
  });
});
