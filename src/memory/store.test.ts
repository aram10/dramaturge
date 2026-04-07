import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StateGraph } from '../graph/state-graph.js';
import type { AreaResult, PageFingerprint, RawFinding } from '../types.js';
import { MemoryStore, buildFindingSignature } from './store.js';

function makeFingerprint(hash: string, path = `/${hash}`): PageFingerprint {
  return {
    normalizedPath: path,
    signature: {
      pathname: path,
      query: [],
      uiMarkers: [],
    },
    title: `Page ${hash}`,
    heading: `Heading ${hash}`,
    dialogTitles: [],
    hash,
  };
}

function makeAreaResult(name: string, url: string, finding: RawFinding): AreaResult {
  return {
    name,
    url,
    steps: 3,
    findings: [finding],
    replayableActions: [],
    screenshots: new Map(),
    evidence: [],
    coverage: {
      controlsDiscovered: 2,
      controlsExercised: 1,
      events: [],
    },
    pageType: 'settings',
    fingerprint: makeFingerprint('settings-fingerprint', '/settings'),
    status: 'explored',
  };
}

describe('MemoryStore', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'dramaturge-memory-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('persists finding history and preserves suppression metadata across reloads', () => {
    const finding: RawFinding = {
      category: 'Visual Glitch',
      severity: 'Minor',
      title: 'Relative timestamps jitter',
      stepsToReproduce: ['Open settings', 'Watch the activity feed header'],
      expected: 'Header layout remains stable',
      actual: 'Relative timestamps cause the header to shift every second',
      meta: {
        source: 'agent',
        confidence: 'low',
        repro: {
          objective: 'Inspect settings screen',
          breadcrumbs: ['observe activity feed header'],
          evidenceIds: [],
        },
      },
    };

    const store = new MemoryStore(tempDir);
    store.recordRunFindings('2026-03-27T12:00:00.000Z', [
      makeAreaResult('Settings', 'https://example.com/settings', finding),
    ]);
    store.markFindingSuppressed(buildFindingSignature(finding), 'Expected animation jitter');

    const reloaded = new MemoryStore(tempDir);
    const snapshot = reloaded.getSnapshot();
    const persisted = snapshot.findingHistory[buildFindingSignature(finding)];

    expect(persisted).toMatchObject({
      title: 'Relative timestamps jitter',
      runCount: 1,
      occurrenceCount: 1,
      suppressed: true,
      dismissalReason: 'Expected animation jitter',
    });
  });

  it('surfaces historical worker context and planner signals for matching routes', () => {
    const finding: RawFinding = {
      category: 'Bug',
      severity: 'Major',
      title: 'Members pane save button sometimes double-renders',
      stepsToReproduce: ['Open members settings', 'Edit a member role'],
      expected: 'Exactly one save button should render',
      actual: 'Two save buttons render for a moment',
    };

    const graph = new StateGraph();
    const root = graph.addNode({
      url: 'https://example.com',
      title: 'Home',
      fingerprint: makeFingerprint('root', '/'),
      pageType: 'dashboard',
      depth: 0,
    });
    const settings = graph.addNode({
      url: 'https://example.com/settings',
      title: 'Settings',
      fingerprint: makeFingerprint('settings', '/settings'),
      pageType: 'settings',
      depth: 1,
      navigationHint: {
        selector: 'role=button[name=Settings]',
        actionDescription: 'Open settings',
      },
    });
    graph.addEdge(root.id, settings.id, {
      actionLabel: 'Open settings',
      navigationHint: {
        selector: 'role=button[name=Settings]',
        actionDescription: 'Open settings',
      },
      targetFingerprint: settings.fingerprint,
      targetPageType: settings.pageType,
    });

    const store = new MemoryStore(tempDir);
    store.recordRunFindings('2026-03-27T12:00:00.000Z', [
      makeAreaResult('Settings', 'https://example.com/settings', finding),
    ]);
    store.recordObservedApiTraffic('2026-03-27T12:00:00.000Z', [
      {
        route: '/api/settings/members',
        methods: ['GET'],
        statuses: [200],
        failures: [],
        samples: [
          {
            method: 'GET',
            status: 200,
            url: '/api/settings/members?tab=active',
            headers: {
              accept: 'application/json',
            },
            responseBody: {
              members: 3,
            },
          },
        ],
      },
      {
        route: '/api/settings/members',
        methods: ['POST'],
        statuses: [400],
        failures: ['validation failed'],
        samples: [
          {
            method: 'POST',
            status: 400,
            url: '/api/settings/members',
            headers: {
              'content-type': 'application/json',
            },
            data: {
              role: 'owner',
            },
            responseBody: {
              error: 'validation failed',
            },
          },
        ],
      },
    ]);
    store.markFindingSuppressed(buildFindingSignature(finding), 'Known transient render');
    store.recordFlakyPage({
      route: 'https://example.com/settings',
      fingerprintHash: 'settings',
      note: 'Relative timestamps refresh every second in the settings header',
      source: 'visual-regression',
    });
    store.recordNavigationSnapshot('https://example.com', graph);
    store.rememberAuthHint('/login');

    const reloaded = new MemoryStore(tempDir);
    const workerContext = reloaded.getWorkerContext({
      url: 'https://example.com/settings',
      fingerprint: settings.fingerprint,
      pageType: 'settings',
    });
    const plannerSignals = reloaded.getPlannerSignals({
      url: 'https://example.com/settings',
      fingerprint: settings.fingerprint,
      pageType: 'settings',
    });

    expect(workerContext.suppressedFindings).toContain(
      'Members pane save button sometimes double-renders'
    );
    expect(workerContext.flakyPageNotes).toContain(
      'Relative timestamps refresh every second in the settings header'
    );
    expect(workerContext.navigationHints.some((hint) => hint.includes('Open settings'))).toBe(true);
    expect(workerContext.authHints).toContain('/login');
    expect(workerContext.apiHints).toEqual([
      {
        route: '/api/settings/members',
        methods: ['GET', 'POST'],
        statuses: [200, 400],
        failures: ['validation failed'],
        samples: [
          {
            method: 'GET',
            status: 200,
            url: '/api/settings/members?tab=active',
            headers: {
              accept: 'application/json',
            },
            responseBody: {
              members: 3,
            },
          },
          {
            method: 'POST',
            status: 400,
            url: '/api/settings/members',
            headers: {
              'content-type': 'application/json',
            },
            data: {
              role: 'owner',
            },
            responseBody: {
              error: 'validation failed',
            },
          },
        ],
      },
    ]);
    expect(plannerSignals).toEqual({
      hasSuppressedFindings: true,
      hasFlakyPageNotes: true,
      hasNavigationHints: true,
    });
  });

  it('persists API request samples across reloads', () => {
    const store = new MemoryStore(tempDir);
    store.recordObservedApiTraffic('2026-03-27T12:00:00.000Z', [
      {
        route: '/api/billing/invoices',
        methods: ['POST'],
        statuses: [422],
        failures: ['validation failed'],
        samples: [
          {
            method: 'POST',
            status: 422,
            url: '/api/billing/invoices?draft=true',
            headers: {
              'content-type': 'application/json',
            },
            data: {
              amount: 0,
            },
            responseBody: {
              error: 'amount must be positive',
            },
          },
        ],
      },
    ]);

    const reloaded = new MemoryStore(tempDir);
    const snapshot = reloaded.getSnapshot();

    expect(snapshot.observedApiCatalog).toEqual([
      expect.objectContaining({
        route: '/api/billing/invoices',
        methods: ['POST'],
        statuses: [422],
        failures: ['validation failed'],
        samples: [
          {
            method: 'POST',
            status: 422,
            url: '/api/billing/invoices?draft=true',
            headers: {
              'content-type': 'application/json',
            },
            data: {
              amount: 0,
            },
            responseBody: {
              error: 'amount must be positive',
            },
          },
        ],
      }),
    ]);
  });
});
