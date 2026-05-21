// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Alex Rambasek

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runConfirmCommand, type ConfirmDependencies } from './confirm.js';
import type { ConfirmationResult } from '../types.js';
import type { FindingReplayManifest } from '../repro/manifest.js';

function makeManifest(): FindingReplayManifest {
  return {
    schemaVersion: 1,
    finding: {
      id: 'BUG-0001',
      signature: '["Bug","Major","Submit fails","ok","bad"]',
      category: 'Bug',
      severity: 'Major',
      title: 'Submit fails',
      expected: 'ok',
      actual: 'bad',
      evidenceTypes: ['console-error'],
    },
    origin: {
      runStartedAt: '2026-05-20T18:00:00.000Z',
      targetUrl: 'https://example.com',
    },
    replay: {
      actions: [],
      breadcrumbs: [],
      objective: 'Confirm submit failure',
      maxStepsBudget: 1,
    },
    oracles: { consoleErrorFragments: ['Cannot read properties of null'] },
  };
}

function makeResult(verdict: ConfirmationResult['verdict']): ConfirmationResult {
  return {
    findingId: 'BUG-0001',
    signature: 'sig',
    verdict,
    confidence: verdict === 'cannot_confirm' ? 'low' : 'high',
    origin: { runStartedAt: '2026-05-20T18:00:00.000Z', targetUrl: 'https://example.com' },
    replay: { actionsRequested: 1, actionsCompleted: verdict === 'cannot_confirm' ? 0 : 1 },
    oracleComparison: {
      consoleErrorsOriginal: 1,
      consoleErrorsCurrent: verdict === 'still_reproducible' ? 1 : 0,
      networkFailuresOriginal: 0,
      networkFailuresCurrent: 0,
      a11yViolationsOriginal: 0,
      a11yViolationsCurrent: 0,
    },
    observedNow: {},
    evidence: { consoleErrors: [] },
    durationMs: 0,
  };
}

interface Harness {
  cwd: string;
  reportDir: string;
  logs: string[];
  errors: string[];
  deps: ConfirmDependencies;
}

function writeManifest(reportDir: string): void {
  const findingsDir = join(reportDir, 'findings');
  mkdirSync(findingsDir, { recursive: true });
  writeFileSync(join(findingsDir, 'BUG-0001.json'), JSON.stringify(makeManifest(), null, 2));
}

function makeHarness(result: ConfirmationResult = makeResult('fixed')): Harness {
  const cwd = mkdtempSync(join(tmpdir(), 'dramaturge-confirm-'));
  const reportDir = join(cwd, 'reports', 'run-1');
  writeManifest(reportDir);
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
      replayManifest: vi.fn().mockResolvedValue(result),
    },
  };
}

describe('runConfirmCommand', () => {
  let h: Harness;

  beforeEach(() => {
    vi.clearAllMocks();
    h = makeHarness();
  });

  afterEach(() => {
    rmSync(h.cwd, { recursive: true, force: true });
  });

  it('returns 0 and renders fixed result', async () => {
    const code = await runConfirmCommand(
      { finding: 'BUG-0001', fromReport: h.reportDir, format: 'short' },
      h.deps
    );

    expect(code).toBe(0);
    expect(h.logs.join('\n')).toContain('BUG-0001 fixed');
  });

  it('returns 1 for still_reproducible', async () => {
    h = makeHarness(makeResult('still_reproducible'));

    const code = await runConfirmCommand(
      { finding: 'BUG-0001', fromReport: h.reportDir, format: 'json' },
      h.deps
    );

    expect(code).toBe(1);
    expect(JSON.parse(h.logs.join('\n'))).toMatchObject({ verdict: 'still_reproducible' });
  });

  it('returns 2 for cannot_confirm', async () => {
    h = makeHarness(makeResult('cannot_confirm'));

    const code = await runConfirmCommand({ finding: 'BUG-0001', fromReport: h.reportDir }, h.deps);

    expect(code).toBe(2);
    expect(h.logs.join('\n')).toContain('cannot_confirm');
  });

  it('loads the newest report with findings when --from-report is omitted', async () => {
    const reportsRoot = join(h.cwd, 'dramaturge-reports');
    const older = join(reportsRoot, '2026-05-19T00-00-00');
    const newer = join(reportsRoot, '2026-05-20T00-00-00');
    writeManifest(older);
    writeManifest(newer);

    const code = await runConfirmCommand({ finding: 'BUG-0001', format: 'short' }, h.deps);

    expect(code).toBe(0);
    expect(h.logs.join('\n')).toContain('BUG-0001 fixed');
  });

  it('loads an explicit config path for future auth-capable replay adapters', async () => {
    const loadConfig = vi.fn();
    h.deps.loadConfig = loadConfig;

    const code = await runConfirmCommand(
      {
        finding: 'BUG-0001',
        fromReport: h.reportDir,
        format: 'short',
        configPath: 'custom.json',
      },
      h.deps
    );

    expect(code).toBe(0);
    expect(loadConfig).toHaveBeenCalledWith('custom.json');
  });

  it('passes loaded config and selected profile into replay context', async () => {
    const config = { targetUrl: 'https://example.com' };
    const replayManifest = vi.fn().mockResolvedValue(makeResult('fixed'));
    h.deps.loadConfig = vi.fn().mockReturnValue(config);
    h.deps.replayManifest = replayManifest;

    const code = await runConfirmCommand(
      {
        finding: 'BUG-0001',
        fromReport: h.reportDir,
        configPath: 'custom.json',
        profile: 'admin',
      },
      h.deps
    );

    expect(code).toBe(0);
    expect(replayManifest).toHaveBeenCalledWith({
      manifest: expect.objectContaining({ finding: expect.objectContaining({ id: 'BUG-0001' }) }),
      config,
      profile: 'admin',
    });
  });

  it('returns usage error when finding is missing', async () => {
    const code = await runConfirmCommand({ fromReport: h.reportDir }, h.deps);

    expect(code).toBe(1);
    expect(h.errors.join('\n')).toContain('Usage: dramaturge confirm');
  });

  it('returns a clear error when the manifest is missing', async () => {
    const code = await runConfirmCommand({ finding: 'BUG-4042', fromReport: h.reportDir }, h.deps);

    expect(code).toBe(2);
    expect(h.errors.join('\n')).toContain('No replay manifest found for BUG-4042');
  });
});
