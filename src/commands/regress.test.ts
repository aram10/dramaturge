// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Alex Rambasek

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runRegressCommand, type RegressDependencies } from './regress.js';
import { renderJson } from '../report/json.js';
import type { AreaResult, RawFinding, ReplayableAction, RunResult } from '../types.js';

interface Harness {
  cwd: string;
  reportDir: string;
  logs: string[];
  errors: string[];
  deps: RegressDependencies;
}

function makeAction(overrides: Partial<ReplayableAction> = {}): ReplayableAction {
  return {
    id: 'act-nav',
    kind: 'navigate',
    url: 'https://example.com/checkout',
    summary: 'navigate to checkout',
    source: 'page',
    status: 'worked',
    timestamp: '2026-05-20T18:01:00.000Z',
    ...overrides,
  };
}

function makeFinding(overrides: Partial<RawFinding> = {}): RawFinding {
  return {
    ref: 'fid-create-dialog',
    category: 'Bug',
    severity: 'Major',
    title: 'Create dialog never opens',
    stepsToReproduce: ['Open checkout', 'Click Create'],
    expected: 'The create dialog opens',
    actual: 'Nothing happens',
    screenshotRef: 'bug.png',
    evidenceIds: ['ev-console'],
    meta: {
      source: 'agent',
      confidence: 'high',
      repro: {
        objective: 'Validate create dialog flow',
        route: 'https://example.com/checkout',
        breadcrumbs: ['Open checkout', 'Click Create'],
        actionIds: ['act-nav', 'act-click'],
        evidenceIds: ['ev-console'],
      },
    },
    ...overrides,
  };
}

function makeArea(overrides: Partial<AreaResult> = {}): AreaResult {
  return {
    name: 'Checkout',
    url: 'https://example.com/checkout',
    steps: 2,
    findings: [makeFinding()],
    replayableActions: [
      makeAction(),
      makeAction({
        id: 'act-click',
        kind: 'click',
        selector: "button[data-testid='create']",
        summary: 'click create',
        timestamp: '2026-05-20T18:01:01.000Z',
      }),
    ],
    screenshots: new Map(),
    evidence: [
      {
        id: 'ev-console',
        type: 'console-error',
        summary: 'Cannot read properties of null',
        timestamp: '2026-05-20T18:01:02.000Z',
        areaName: 'Checkout',
        relatedFindingIds: ['fid-create-dialog'],
      },
    ],
    coverage: { controlsDiscovered: 1, controlsExercised: 1, events: [] },
    pageType: 'form',
    status: 'explored',
    ...overrides,
  };
}

function makeRunResult(overrides: Partial<RunResult> = {}): RunResult {
  return {
    targetUrl: 'https://example.com',
    startTime: new Date('2026-05-20T18:00:00.000Z'),
    endTime: new Date('2026-05-20T18:10:00.000Z'),
    areaResults: [makeArea()],
    unexploredAreas: [],
    partial: false,
    blindSpots: [],
    ...overrides,
  };
}

function writeReport(reportDir: string, runResult: RunResult = makeRunResult()): void {
  mkdirSync(reportDir, { recursive: true });
  writeFileSync(join(reportDir, 'report.json'), renderJson(runResult));
}

function makeHarness(runResult?: RunResult): Harness {
  const cwd = mkdtempSync(join(tmpdir(), 'dramaturge-regress-'));
  const reportDir = join(cwd, 'dramaturge-reports', 'run-1');
  writeReport(reportDir, runResult);
  const logs: string[] = [];
  const errors: string[] = [];
  return {
    cwd,
    reportDir,
    logs,
    errors,
    deps: {
      cwd,
      log: (message) => logs.push(message),
      error: (message) => errors.push(message),
    },
  };
}

describe('runRegressCommand', () => {
  let h: Harness;

  beforeEach(() => {
    h = makeHarness();
  });

  afterEach(() => {
    rmSync(h.cwd, { recursive: true, force: true });
  });

  it('lists findings with quality scores and promotable status from report.json', () => {
    const code = runRegressCommand(
      { subcommand: 'list', positional: [], fromReport: h.reportDir },
      h.deps
    );

    expect(code).toBe(0);
    const output = h.logs.join('\n');
    expect(output).toContain('BUG-001');
    expect(output).toContain('85/100');
    expect(output).toContain('yes');
  });

  it('prints a generated Playwright spec for promotable findings in dry-run mode', () => {
    const outputDir = join(h.cwd, 'tests', 'dramaturge');
    const code = runRegressCommand(
      {
        subcommand: 'promote',
        positional: ['BUG-001'],
        fromReport: h.reportDir,
        dryRun: true,
        output: outputDir,
      },
      h.deps
    );

    expect(code).toBe(0);
    const output = h.logs.join('\n');
    expect(output).toContain('// filename: BUG-001__create-dialog-never-opens.spec.ts');
    expect(output).toContain('@dramaturge-spec-version 1');
    expect(output).toContain('@dramaturge-finding BUG-001');
    expect(output).toContain('@dramaturge-signature ["Bug","/checkout"');
    expect(output).toContain('@dramaturge-origin-run 2026-05-20T18:00:00.000Z');
    expect(output).toContain('@dramaturge-source-report dramaturge-reports');
    expect(output).toContain('import { test, expect } from "@playwright/test";');
    expect(output).toContain('await page.goto("https://example.com/checkout");');
    expect(output).toContain('button[data-testid');
    expect(existsSync(outputDir)).toBe(false);
  });

  it('uses exploration ledger actions when report action rows are unavailable', () => {
    rmSync(h.cwd, { recursive: true, force: true });
    const click = makeAction({
      id: 'act-click',
      kind: 'click',
      selector: "button[data-testid='create']",
      summary: 'click create from ledger',
      timestamp: '2026-05-20T18:01:01.000Z',
    });
    h = makeHarness(
      makeRunResult({
        areaResults: [
          makeArea({
            replayableActions: [],
          }),
        ],
        explorationLedger: {
          version: 1,
          events: [
            {
              id: 'ledger-action-1',
              kind: 'action',
              actionId: click.id,
              action: click,
              timestamp: click.timestamp,
              areaName: 'Checkout',
              source: 'action-recorder',
            },
          ],
        },
      })
    );

    const code = runRegressCommand(
      {
        subcommand: 'promote',
        positional: ['BUG-001'],
        fromReport: h.reportDir,
        dryRun: true,
      },
      h.deps
    );

    expect(code).toBe(0);
    expect(h.logs.join('\n')).toContain('click();');
  });

  it('uses normalized finding-id evidence links for dry-run assertion inference', () => {
    const code = runRegressCommand(
      {
        subcommand: 'promote',
        positional: ['BUG-001'],
        fromReport: h.reportDir,
        dryRun: true,
      },
      h.deps
    );

    expect(code).toBe(0);
    const output = h.logs.join('\n');
    expect(output).toContain('const consoleErrors: string[] = [];');
    expect(output).toContain(
      'expect(consoleErrors, "No console errors expected").toHaveLength(0);'
    );
  });

  it('writes a generated Playwright spec for promotable findings', () => {
    const code = runRegressCommand(
      {
        subcommand: 'promote',
        positional: ['BUG-001'],
        fromReport: h.reportDir,
        output: 'tests/dramaturge',
      },
      h.deps
    );

    const outputPath = join(
      h.cwd,
      'tests',
      'dramaturge',
      'BUG-001__create-dialog-never-opens.spec.ts'
    );
    const content = readFileSync(outputPath, 'utf-8');

    expect(code).toBe(0);
    expect(h.logs.join('\n')).toContain(
      'Wrote tests/dramaturge/BUG-001__create-dialog-never-opens.spec.ts'
    );
    expect(content).toContain('@dramaturge-finding BUG-001');
    expect(content).toContain(
      'To re-generate: npx dramaturge regress promote BUG-001 --from-report dramaturge-reports/run-1 --output tests/dramaturge --force'
    );
    expect(content).toContain('import { test, expect } from "@playwright/test";');
  });

  it('defaults non-dry-run writes to tests/dramaturge', () => {
    const code = runRegressCommand(
      { subcommand: 'promote', positional: ['BUG-001'], fromReport: h.reportDir },
      h.deps
    );

    expect(code).toBe(0);
    expect(
      existsSync(join(h.cwd, 'tests', 'dramaturge', 'BUG-001__create-dialog-never-opens.spec.ts'))
    ).toBe(true);
  });

  it('refuses to overwrite an existing promoted spec without force', () => {
    const outputPath = join(
      h.cwd,
      'tests',
      'dramaturge',
      'BUG-001__create-dialog-never-opens.spec.ts'
    );

    expect(
      runRegressCommand(
        { subcommand: 'promote', positional: ['BUG-001'], fromReport: h.reportDir },
        h.deps
      )
    ).toBe(0);

    const code = runRegressCommand(
      { subcommand: 'promote', positional: ['BUG-001'], fromReport: h.reportDir },
      h.deps
    );

    expect(code).toBe(1);
    expect(h.errors.join('\n')).toContain('Refusing to overwrite existing regression spec');
    expect(readFileSync(outputPath, 'utf-8')).toContain('@dramaturge-finding BUG-001');
  });

  it('overwrites an existing promoted spec with force', () => {
    const outputDir = join(h.cwd, 'tests', 'dramaturge');
    const outputPath = join(outputDir, 'BUG-001__create-dialog-never-opens.spec.ts');
    mkdirSync(outputDir, { recursive: true });
    writeFileSync(outputPath, 'stale content');

    const code = runRegressCommand(
      { subcommand: 'promote', positional: ['BUG-001'], fromReport: h.reportDir, force: true },
      h.deps
    );

    expect(code).toBe(0);
    const content = readFileSync(outputPath, 'utf-8');
    expect(content).toContain('@dramaturge-finding BUG-001');
    expect(content).not.toBe('stale content');
  });

  it('escapes provenance header values before writing specs', () => {
    rmSync(h.cwd, { recursive: true, force: true });
    h = makeHarness(
      makeRunResult({
        areaResults: [
          makeArea({
            findings: [
              makeFinding({
                title: 'Create dialog */ closes\nwith comment terminator',
                actual:
                  'Nothing happens */ and a newline\nis present\u2028with unicode separator\u2029',
              }),
            ],
          }),
        ],
      })
    );

    const code = runRegressCommand(
      { subcommand: 'promote', positional: ['BUG-001'], fromReport: h.reportDir },
      h.deps
    );

    const outputPath = join(
      h.cwd,
      'tests',
      'dramaturge',
      'BUG-001__create-dialog-closes-with-comment-terminator.spec.ts'
    );
    const content = readFileSync(outputPath, 'utf-8');
    const header = content.slice(0, content.indexOf(' */') + 3);

    expect(code).toBe(0);
    expect(header).toContain('*\\/');
    expect(header).not.toContain('*/ closes');
    expect(header).not.toContain('newline\nis present');
    expect(header).not.toContain('\u2028');
    expect(header).not.toContain('\u2029');
  });

  it('includes --force in promote usage text', () => {
    const code = runRegressCommand({ subcommand: 'promote', positional: [] }, h.deps);

    expect(code).toBe(1);
    expect(h.errors.join('\n')).toContain(
      'Usage: dramaturge regress promote <finding-id> [--dry-run] [--output <dir>] [--force]'
    );
  });

  it('refuses to promote low-quality findings', () => {
    rmSync(h.cwd, { recursive: true, force: true });
    h = makeHarness(
      makeRunResult({
        areaResults: [
          makeArea({
            name: 'Settings',
            url: 'https://example.com/settings',
            findings: [
              makeFinding({
                ref: 'fid-settings',
                category: 'UX Concern',
                severity: 'Minor',
                title: 'Save feedback is unclear',
                evidenceIds: [],
                screenshotRef: undefined,
                meta: {
                  source: 'agent',
                  confidence: 'low',
                  repro: {
                    objective: 'Inspect save feedback',
                    route: 'https://example.com/settings',
                    breadcrumbs: ['Open settings'],
                    evidenceIds: [],
                  },
                },
              }),
            ],
            replayableActions: [],
            evidence: [],
          }),
        ],
      })
    );

    const code = runRegressCommand(
      {
        subcommand: 'promote',
        positional: ['UX-001'],
        fromReport: h.reportDir,
        dryRun: true,
      },
      h.deps
    );

    expect(code).toBe(1);
    expect(h.errors.join('\n')).toContain('not promotable');
  });

  it('reports a missing report clearly', () => {
    const code = runRegressCommand(
      { subcommand: 'list', positional: [], fromReport: join(h.cwd, 'missing') },
      h.deps
    );

    expect(code).toBe(1);
    expect(h.errors.join('\n')).toContain('No report.json found');
  });
});
