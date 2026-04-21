// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Alex Rambasek

import { describe, expect, it } from 'vitest';
import { renderSarif } from './sarif.js';
import type { AreaResult, RunResult } from '../types.js';

function makeResult(areaResults: AreaResult[], partial = false): RunResult {
  return {
    targetUrl: 'https://example.com',
    startTime: new Date('2026-03-25T10:00:00Z'),
    endTime: new Date('2026-03-25T10:05:00Z'),
    areaResults,
    unexploredAreas: [],
    partial,
    blindSpots: [],
  };
}

function makeArea(overrides: Partial<AreaResult> = {}): AreaResult {
  return {
    name: 'Area',
    url: 'https://example.com/area',
    steps: 1,
    findings: [],
    screenshots: new Map(),
    evidence: [],
    coverage: { controlsDiscovered: 0, controlsExercised: 0, events: [] },
    pageType: 'list',
    status: 'explored',
    ...overrides,
  };
}

describe('renderSarif', () => {
  it('produces a SARIF v2.1.0 document with expected top-level shape', () => {
    const sarif = JSON.parse(renderSarif(makeResult([makeArea()])));
    expect(sarif.version).toBe('2.1.0');
    expect(typeof sarif.$schema).toBe('string');
    expect(Array.isArray(sarif.runs)).toBe(true);
    expect(sarif.runs).toHaveLength(1);
    expect(sarif.runs[0].tool.driver.name).toBe('dramaturge');
    expect(Array.isArray(sarif.runs[0].results)).toBe(true);
    expect(sarif.runs[0].invocations[0].executionSuccessful).toBe(true);
  });

  it('maps severities to SARIF levels and registers per-category rules', () => {
    const sarif = JSON.parse(
      renderSarif(
        makeResult([
          makeArea({
            findings: [
              {
                category: 'Bug',
                severity: 'Critical',
                title: 'Critical bug',
                stepsToReproduce: ['step'],
                expected: 'x',
                actual: 'y',
              },
              {
                category: 'Accessibility Issue',
                severity: 'Minor',
                title: 'Missing label',
                stepsToReproduce: ['step'],
                expected: 'a',
                actual: 'b',
              },
              {
                category: 'Performance Issue',
                severity: 'Trivial',
                title: 'Slow image',
                stepsToReproduce: ['step'],
                expected: 'fast',
                actual: 'slow',
              },
            ],
          }),
        ])
      )
    );

    const levels = sarif.runs[0].results.map((r: { level: string }) => r.level);
    expect(levels).toEqual(expect.arrayContaining(['error', 'warning', 'note']));

    const ruleIds = sarif.runs[0].tool.driver.rules.map((r: { id: string }) => r.id);
    expect(ruleIds).toEqual(
      expect.arrayContaining(['dramaturge.bug', 'dramaturge.a11y', 'dramaturge.performance'])
    );

    for (const result of sarif.runs[0].results) {
      expect(result.properties['dramaturge.id']).toMatch(/^[A-Z0-9]+-\d+$/);
      expect(result.partialFingerprints['dramaturge/v1']).toBe(result.properties['dramaturge.id']);
    }
  });

  it('attaches route and screenshot locations when available', () => {
    const sarif = JSON.parse(
      renderSarif(
        makeResult([
          makeArea({
            findings: [
              {
                ref: 'fid-1',
                category: 'Bug',
                severity: 'Major',
                title: 'Broken create',
                stepsToReproduce: ['step'],
                expected: 'x',
                actual: 'y',
                evidenceIds: ['ev-1'],
                meta: {
                  source: 'agent',
                  confidence: 'medium',
                  repro: {
                    objective: 'Investigate',
                    breadcrumbs: [],
                    evidenceIds: ['ev-1'],
                    route: 'https://example.com/area/create',
                  },
                },
              },
            ],
            evidence: [
              {
                id: 'ev-1',
                type: 'screenshot',
                summary: 'Before',
                path: 'screenshots/ss-1.png',
                timestamp: '2026-03-25T10:01:00Z',
                areaName: 'Area',
                relatedFindingIds: ['fid-1'],
              },
            ],
          }),
        ])
      )
    );

    const locations = sarif.runs[0].results[0].locations;
    expect(locations).toBeDefined();
    const uris = locations.map(
      (loc: { physicalLocation: { artifactLocation: { uri: string } } }) =>
        loc.physicalLocation.artifactLocation.uri
    );
    expect(uris).toEqual(
      expect.arrayContaining(['https://example.com/area/create', 'screenshots/ss-1.png'])
    );
  });

  it('marks execution as unsuccessful for partial runs', () => {
    const sarif = JSON.parse(renderSarif(makeResult([makeArea()], true)));
    expect(sarif.runs[0].invocations[0].executionSuccessful).toBe(false);
  });
});
