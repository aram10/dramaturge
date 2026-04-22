// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Alex Rambasek

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runTriageCommand, type TriageDependencies } from './triage.js';
import type { MemorySnapshot, HistoricalFindingRecord } from '../memory/types.js';

function makeRecord(overrides: Partial<HistoricalFindingRecord> = {}): HistoricalFindingRecord {
  return {
    signature: 'sig-abcdef123456',
    title: 'Example finding',
    category: 'Bug',
    severity: 'Major',
    firstSeenAt: '2026-03-01T10:00:00.000Z',
    lastSeenAt: '2026-03-20T10:00:00.000Z',
    runCount: 3,
    occurrenceCount: 5,
    recentRoutes: ['/x'],
    ...overrides,
  };
}

function writeSnapshot(dir: string, findings: HistoricalFindingRecord[]): void {
  const snapshot: MemorySnapshot = {
    version: 1,
    updatedAt: '2026-03-25T12:00:00.000Z',
    findingHistory: Object.fromEntries(findings.map((f) => [f.signature, f])),
    flakyPages: [],
    authHints: { successfulLoginRoutes: [] },
    observedApiCatalog: [],
  };
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'memory.json'), JSON.stringify(snapshot, null, 2));
}

function makeConfig(cwd: string, memoryDir: string, baselineDir: string): void {
  writeFileSync(
    join(cwd, 'dramaturge.config.json'),
    JSON.stringify({
      targetUrl: 'https://example.com',
      memory: { dir: memoryDir },
      visualRegression: { baselineDir },
    })
  );
}

interface Harness {
  cwd: string;
  memoryDir: string;
  baselineDir: string;
  deps: TriageDependencies;
  logs: string[];
  errs: string[];
}

function makeHarness(): Harness {
  const cwd = mkdtempSync(join(tmpdir(), 'dramaturge-triage-'));
  const memoryDir = join(cwd, '.dramaturge');
  const baselineDir = join(memoryDir, 'visual-baselines');
  mkdirSync(baselineDir, { recursive: true });
  makeConfig(cwd, memoryDir, baselineDir);
  const logs: string[] = [];
  const errs: string[] = [];
  const deps: TriageDependencies = {
    cwd,
    log: (m) => logs.push(m),
    error: (m) => errs.push(m),
  };
  return { cwd, memoryDir, baselineDir, deps, logs, errs };
}

describe('runTriageCommand', () => {
  let h: Harness;

  beforeEach(() => {
    h = makeHarness();
  });

  afterEach(() => {
    rmSync(h.cwd, { recursive: true, force: true });
  });

  describe('findings list', () => {
    it('logs empty-state message when no records exist', () => {
      writeSnapshot(h.memoryDir, []);
      const code = runTriageCommand(
        { command: 'findings', subcommand: 'list', flags: {}, positional: [] },
        h.deps
      );
      expect(code).toBe(0);
      expect(h.logs.join('\n')).toContain('No findings in memory store');
    });

    it('prints a table of findings sorted by lastSeenAt', () => {
      writeSnapshot(h.memoryDir, [
        makeRecord({
          signature: 'older000000000',
          lastSeenAt: '2026-01-01T00:00:00Z',
          title: 'Older',
        }),
        makeRecord({
          signature: 'newer000000000',
          lastSeenAt: '2026-03-20T00:00:00Z',
          title: 'Newer',
        }),
      ]);
      const code = runTriageCommand(
        { command: 'findings', subcommand: 'list', flags: {}, positional: [] },
        h.deps
      );
      expect(code).toBe(0);
      const output = h.logs.join('\n');
      expect(output).toContain('Newer');
      expect(output).toContain('Older');
      expect(output.indexOf('Newer')).toBeLessThan(output.indexOf('Older'));
    });

    it('--suppressed filters to suppressed records only', () => {
      writeSnapshot(h.memoryDir, [
        makeRecord({ signature: 'a0000000000000', title: 'Kept', suppressed: false }),
        makeRecord({ signature: 'b0000000000000', title: 'Hidden', suppressed: true }),
      ]);
      const code = runTriageCommand(
        { command: 'findings', subcommand: 'list', flags: { suppressed: true }, positional: [] },
        h.deps
      );
      expect(code).toBe(0);
      const output = h.logs.join('\n');
      expect(output).toContain('Hidden');
      expect(output).not.toContain('Kept');
    });
  });

  describe('findings suppress', () => {
    it('errors when signature is missing', () => {
      writeSnapshot(h.memoryDir, []);
      const code = runTriageCommand(
        { command: 'findings', subcommand: 'suppress', flags: {}, positional: [] },
        h.deps
      );
      expect(code).toBe(1);
      expect(h.errs.join('\n')).toContain('Usage');
    });

    it('matches by 12-char prefix and writes suppression to memory', () => {
      writeSnapshot(h.memoryDir, [makeRecord({ signature: 'abcdef123456zzz' })]);
      const code = runTriageCommand(
        {
          command: 'findings',
          subcommand: 'suppress',
          flags: { reason: 'known false positive' },
          positional: ['abcdef123456'],
        },
        h.deps
      );
      expect(code).toBe(0);
      const snapshot = JSON.parse(
        readFileSync(join(h.memoryDir, 'memory.json'), 'utf-8')
      ) as MemorySnapshot;
      expect(snapshot.findingHistory['abcdef123456zzz'].suppressed).toBe(true);
      expect(snapshot.findingHistory['abcdef123456zzz'].dismissalReason).toBe(
        'known false positive'
      );
    });

    it('errors when no record matches', () => {
      writeSnapshot(h.memoryDir, [makeRecord({ signature: 'abcdef' })]);
      const code = runTriageCommand(
        {
          command: 'findings',
          subcommand: 'suppress',
          flags: {},
          positional: ['nomatch'],
        },
        h.deps
      );
      expect(code).toBe(1);
      expect(h.errs.join('\n')).toContain('No finding matching');
    });
  });

  describe('findings unsuppress', () => {
    it('clears the suppressed flag', () => {
      writeSnapshot(h.memoryDir, [
        makeRecord({
          signature: 'suppressed123xx',
          suppressed: true,
          dismissalReason: 'old reason',
          dismissedAt: '2026-03-01T00:00:00Z',
        }),
      ]);
      const code = runTriageCommand(
        {
          command: 'findings',
          subcommand: 'unsuppress',
          flags: {},
          positional: ['suppressed123'],
        },
        h.deps
      );
      expect(code).toBe(0);
      const snapshot = JSON.parse(
        readFileSync(join(h.memoryDir, 'memory.json'), 'utf-8')
      ) as MemorySnapshot;
      expect(snapshot.findingHistory['suppressed123xx'].suppressed).toBe(false);
      expect(snapshot.findingHistory['suppressed123xx'].dismissalReason).toBeUndefined();
    });

    it('is a no-op when record is already unsuppressed', () => {
      writeSnapshot(h.memoryDir, [makeRecord({ signature: 'notsup123abcxx' })]);
      const code = runTriageCommand(
        {
          command: 'findings',
          subcommand: 'unsuppress',
          flags: {},
          positional: ['notsup123abc'],
        },
        h.deps
      );
      expect(code).toBe(0);
      expect(h.logs.join('\n')).toContain('was not suppressed');
    });
  });

  describe('baselines list / approve', () => {
    it('reports empty state', () => {
      const code = runTriageCommand(
        { command: 'baselines', subcommand: 'list', flags: {}, positional: [] },
        h.deps
      );
      expect(code).toBe(0);
      expect(h.logs.join('\n')).toContain('No visual baselines');
    });

    it('lists baseline files with dimensions', () => {
      writeFileSync(join(h.baselineDir, 'abc123-1280x720.png'), 'fake');
      const code = runTriageCommand(
        { command: 'baselines', subcommand: 'list', flags: {}, positional: [] },
        h.deps
      );
      expect(code).toBe(0);
      const out = h.logs.join('\n');
      expect(out).toContain('abc123');
      expect(out).toContain('1280x720');
    });

    it('approve --all deletes every baseline', () => {
      writeFileSync(join(h.baselineDir, 'a-100x100.png'), 'fake');
      writeFileSync(join(h.baselineDir, 'b-100x100.png'), 'fake');
      const code = runTriageCommand(
        { command: 'baselines', subcommand: 'approve', flags: { all: true }, positional: [] },
        h.deps
      );
      expect(code).toBe(0);
      expect(h.logs.join('\n')).toContain('Removed 2 baseline');
    });

    it('approve requires --all or positional identifiers', () => {
      const code = runTriageCommand(
        { command: 'baselines', subcommand: 'approve', flags: {}, positional: [] },
        h.deps
      );
      expect(code).toBe(1);
      expect(h.errs.join('\n')).toContain('Usage');
    });

    it('approve reports notFound for unknown identifiers', () => {
      writeFileSync(join(h.baselineDir, 'abc-100x100.png'), 'fake');
      const code = runTriageCommand(
        {
          command: 'baselines',
          subcommand: 'approve',
          flags: {},
          positional: ['abc', 'nope'],
        },
        h.deps
      );
      expect(code).toBe(1);
      expect(h.errs.join('\n')).toContain('No baseline matching: nope');
    });
  });

  describe('memory stats', () => {
    it('prints stats summary', () => {
      writeSnapshot(h.memoryDir, [
        makeRecord({ signature: 's1xxxxxxxxxxxx' }),
        makeRecord({ signature: 's2xxxxxxxxxxxx', suppressed: true }),
      ]);
      const code = runTriageCommand(
        { command: 'memory', subcommand: 'stats', flags: {}, positional: [] },
        h.deps
      );
      expect(code).toBe(0);
      const out = h.logs.join('\n');
      expect(out).toContain('total history entries: 2');
      expect(out).toContain('suppressed:            1');
    });
  });

  describe('error cases', () => {
    it('rejects unknown command', () => {
      const code = runTriageCommand(
        // @ts-expect-error testing runtime validation
        { command: 'bogus', subcommand: 'list', flags: {}, positional: [] },
        h.deps
      );
      expect(code).toBe(1);
    });

    it('rejects unknown findings subcommand', () => {
      writeSnapshot(h.memoryDir, []);
      const code = runTriageCommand(
        { command: 'findings', subcommand: 'frobnicate', flags: {}, positional: [] },
        h.deps
      );
      expect(code).toBe(1);
      expect(h.errs.join('\n')).toContain('Unknown findings subcommand');
    });
  });
});
