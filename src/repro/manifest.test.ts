// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Alex Rambasek

import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Evidence, RawFinding, ReplayableAction, RunResult } from '../types.js';
import {
  buildFindingReplayManifests,
  loadFindingReplayManifest,
  writeFindingReplayManifests,
} from './manifest.js';

function makeAction(overrides: Partial<ReplayableAction> = {}): ReplayableAction {
  return {
    id: 'act-1',
    kind: 'click',
    summary: 'Click submit',
    source: 'page',
    status: 'recorded',
    timestamp: '2026-05-20T18:00:00.000Z',
    selector: 'button[type="submit"]',
    ...overrides,
  };
}

function makeEvidence(overrides: Partial<Evidence> = {}): Evidence {
  return {
    id: 'ev-1',
    type: 'console-error',
    summary: 'Cannot read properties of null',
    timestamp: '2026-05-20T18:01:00.000Z',
    relatedFindingIds: ['fid-1'],
    ...overrides,
  };
}

function makeFinding(overrides: Partial<RawFinding> = {}): RawFinding {
  return {
    ref: 'fid-1',
    category: 'Bug',
    severity: 'Major',
    title: 'Submit fails',
    stepsToReproduce: ['Open checkout', 'Click submit'],
    expected: 'Order is submitted',
    actual: 'Console error appears',
    evidenceIds: ['ev-1', 'ev-2'],
    meta: {
      source: 'agent',
      confidence: 'high',
      repro: {
        route: '/checkout',
        objective: 'Submit checkout form',
        breadcrumbs: ['checkout', 'submit'],
        actionIds: ['act-1'],
        evidenceIds: ['ev-1', 'ev-2'],
      },
    },
    ...overrides,
  };
}

function makeRunResult(overrides: Partial<RunResult> = {}): RunResult {
  return {
    targetUrl: 'https://example.com',
    startTime: new Date('2026-05-20T18:00:00.000Z'),
    endTime: new Date('2026-05-20T18:02:00.000Z'),
    areaResults: [
      {
        name: 'Checkout',
        url: 'https://example.com/checkout',
        steps: 2,
        findings: [makeFinding()],
        replayableActions: [makeAction()],
        screenshots: new Map(),
        evidence: [
          makeEvidence(),
          makeEvidence({
            id: 'ev-2',
            type: 'network-error',
            summary: 'POST /api/orders returned 500',
          }),
        ],
        coverage: { controlsDiscovered: 1, controlsExercised: 1, events: [] },
        pageType: 'form',
        status: 'explored',
      },
    ],
    unexploredAreas: [],
    partial: false,
    blindSpots: [],
    ...overrides,
  };
}

describe('finding replay manifests', () => {
  let tempDir: string | undefined;

  afterEach(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  });

  it('builds manifests with origin, replay, and oracle data', () => {
    const [manifest] = buildFindingReplayManifests(makeRunResult());

    expect(manifest.finding).toMatchObject({
      id: 'BUG-001',
      category: 'Bug',
      severity: 'Major',
      title: 'Submit fails',
      evidenceTypes: ['console-error', 'network-error'],
    });
    expect(manifest.origin).toMatchObject({
      runStartedAt: '2026-05-20T18:00:00.000Z',
      targetUrl: 'https://example.com',
      route: '/checkout',
    });
    expect(manifest.replay.actions.map((action) => action.id)).toEqual(['act-1']);
    expect(manifest.replay.breadcrumbs).toEqual(['checkout', 'submit']);
    expect(manifest.oracles.consoleErrorFragments).toEqual(['Cannot read properties of null']);
    expect(manifest.oracles.networkFailures).toEqual([{ urlPattern: '/api/orders', status: 500 }]);
  });

  it('writes and loads a per-finding manifest under findings directory', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'dramaturge-manifest-'));

    const [path] = writeFindingReplayManifests(tempDir, makeRunResult());
    const raw = JSON.parse(readFileSync(path, 'utf-8')) as unknown;
    const loaded = loadFindingReplayManifest(tempDir, 'BUG-001');

    expect(raw).toMatchObject({ schemaVersion: 1 });
    expect(loaded.finding.id).toBe('BUG-001');
  });

  it('does not broaden replay to every area action when repro action IDs are absent', () => {
    const [manifest] = buildFindingReplayManifests(
      makeRunResult({
        areaResults: [
          {
            name: 'Checkout',
            url: 'https://example.com/checkout',
            steps: 2,
            findings: [
              makeFinding({
                meta: {
                  source: 'auto-capture',
                  confidence: 'medium',
                  repro: {
                    route: '/checkout',
                    objective: 'Investigate captured error',
                    breadcrumbs: ['checkout'],
                    evidenceIds: ['ev-1'],
                  },
                },
              }),
            ],
            replayableActions: [makeAction()],
            screenshots: new Map(),
            evidence: [makeEvidence()],
            coverage: { controlsDiscovered: 1, controlsExercised: 1, events: [] },
            pageType: 'form',
            status: 'explored',
          },
        ],
      }),
      { authProfile: 'admin' }
    );

    expect(manifest.origin.authProfile).toBe('admin');
    expect(manifest.replay.actions).toEqual([]);
  });

  it('carries accessibility and visual oracle references when current evidence exposes them', () => {
    const [manifest] = buildFindingReplayManifests(
      makeRunResult({
        areaResults: [
          {
            name: 'Checkout',
            url: 'https://example.com/checkout',
            steps: 2,
            findings: [
              makeFinding({
                expected: 'The page should satisfy accessibility rule color-contrast.',
                evidenceIds: ['ev-a11y', 'ev-visual'],
              }),
            ],
            replayableActions: [makeAction()],
            screenshots: new Map(),
            evidence: [
              makeEvidence({
                id: 'ev-a11y',
                type: 'accessibility-scan',
                summary: 'serious: Elements must have sufficient color contrast',
              }),
              makeEvidence({
                id: 'ev-visual',
                type: 'visual-diff',
                summary: 'Visual diff for Checkout',
                path: 'visual-diffs/abc.png',
              }),
            ],
            coverage: { controlsDiscovered: 1, controlsExercised: 1, events: [] },
            pageType: 'form',
            status: 'explored',
          },
        ],
      })
    );

    expect(manifest.oracles.a11yRuleIds).toEqual(['color-contrast']);
    expect(manifest.oracles.visualBaselineRef).toBe('visual-diffs/abc.png');
  });

  it('throws a targeted validation error when a manifest has an invalid shape', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'dramaturge-manifest-'));
    const findingsDir = join(tempDir, 'findings');
    mkdirSync(findingsDir, { recursive: true });
    writeFileSync(
      join(findingsDir, 'BUG-0001.json'),
      JSON.stringify({
        schemaVersion: 1,
        finding: { id: 'BUG-0001' },
      }),
      'utf-8'
    );

    expect(() => loadFindingReplayManifest(tempDir, 'BUG-0001')).toThrow(
      'Invalid finding replay manifest: finding.signature'
    );
  });

  it('throws a clear error when a manifest is missing', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'dramaturge-manifest-'));

    expect(() => loadFindingReplayManifest(tempDir, 'BUG-4042')).toThrow(
      'No replay manifest found for BUG-4042'
    );
  });
});
