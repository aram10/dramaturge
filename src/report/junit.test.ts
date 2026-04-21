// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Alex Rambasek

import { describe, expect, it } from 'vitest';
import { renderJunit } from './junit.js';
import type { AreaResult, RunResult } from '../types.js';

function makeResult(areaResults: AreaResult[]): RunResult {
  return {
    targetUrl: 'https://example.com',
    startTime: new Date('2026-03-25T10:00:00Z'),
    endTime: new Date('2026-03-25T10:00:30Z'),
    areaResults,
    unexploredAreas: [],
    partial: false,
    blindSpots: [],
  };
}

function makeArea(overrides: Partial<AreaResult> = {}): AreaResult {
  return {
    name: 'Knowledge bases',
    url: 'https://example.com/kb',
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

describe('renderJunit', () => {
  it('emits a well-formed empty suite when there are no findings', () => {
    const xml = renderJunit(makeResult([makeArea({ findings: [] })]));
    expect(xml).toMatch(/^<\?xml version="1.0" encoding="UTF-8"\?>\n/);
    expect(xml).toContain('<testsuites name="Dramaturge — https://example.com"');
    expect(xml).toContain('tests="0"');
    expect(xml).toContain('failures="0"');
    expect(xml.trim().endsWith('</testsuites>')).toBe(true);
  });

  it('produces one failing testcase per finding with category and severity in the message', () => {
    const xml = renderJunit(
      makeResult([
        makeArea({
          findings: [
            {
              ref: 'fid-1',
              category: 'Bug',
              severity: 'Major',
              title: 'Create button stops responding',
              stepsToReproduce: ['Open the page', 'Click Create'],
              expected: 'A dialog opens',
              actual: 'Nothing happens',
              evidenceIds: ['ev-1'],
              meta: {
                source: 'agent',
                confidence: 'medium',
                repro: {
                  objective: 'Investigate',
                  breadcrumbs: [],
                  evidenceIds: ['ev-1'],
                  route: 'https://example.com/kb',
                },
              },
            },
          ],
        }),
      ])
    );

    expect(xml).toContain('tests="1"');
    expect(xml).toContain('failures="1"');
    expect(xml).toMatch(/<testcase classname="dramaturge\.Bug"/);
    expect(xml).toMatch(/name="BUG-001 Create button stops responding"/);
    expect(xml).toContain('message="Bug (Major): Create button stops responding"');
    expect(xml).toContain('type="major"');
    expect(xml).toContain('Steps to reproduce:');
    expect(xml).toContain('Expected: A dialog opens');
    expect(xml).toContain('Actual: Nothing happens');
    expect(xml).toContain('Route: https://example.com/kb');
    expect(xml).toContain('Evidence: ev-1');
  });

  it('escapes XML-sensitive characters in finding text', () => {
    const xml = renderJunit(
      makeResult([
        makeArea({
          findings: [
            {
              category: 'Bug',
              severity: 'Critical',
              title: 'Crash on <script> & "quotes"',
              stepsToReproduce: ['Type <html>'],
              expected: 'No crash',
              actual: '<error> happened',
            },
          ],
        }),
      ])
    );

    expect(xml).toContain('&lt;script&gt;');
    expect(xml).toContain('&amp;');
    expect(xml).toContain('&quot;quotes&quot;');
    expect(xml).not.toContain('<script>');
  });
});
