// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Alex Rambasek

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadConfig } from '../config.js';
import { MemoryStore } from '../memory/store.js';
import type { HistoricalFindingRecord } from '../memory/types.js';
import { approveBaselines, listBaselineFiles } from '../coverage/visual-baselines.js';

export interface TriageDependencies {
  log: (message: string) => void;
  error: (message: string) => void;
  cwd: string;
}

interface ResolvedTriagePaths {
  memoryDir: string;
  baselineDir: string;
}

function resolveTriagePaths(cwd: string, configPath?: string): ResolvedTriagePaths {
  const candidatePath = configPath
    ? resolve(cwd, configPath)
    : (() => {
        const defaults = ['dramaturge.config.json', 'dramaturge.config.jsonc'];
        for (const name of defaults) {
          const candidate = resolve(cwd, name);
          if (existsSync(candidate)) return candidate;
        }
        return undefined;
      })();

  if (candidatePath && existsSync(candidatePath)) {
    try {
      const config = loadConfig(candidatePath);
      return {
        memoryDir: config.memory.dir,
        baselineDir: config.visualRegression.baselineDir,
      };
    } catch {
      // Fall through to defaults when the config is unreadable; triage commands
      // should still work for users whose config is temporarily broken.
    }
  }

  return {
    memoryDir: resolve(cwd, './.dramaturge'),
    baselineDir: resolve(cwd, './.dramaturge/visual-baselines'),
  };
}

function formatDate(value: string): string {
  return value.length >= 10 ? value.slice(0, 10) : value;
}

function listFindings(
  deps: TriageDependencies,
  paths: ResolvedTriagePaths,
  options: { suppressedOnly: boolean }
): number {
  const store = new MemoryStore(paths.memoryDir);
  const snapshot = store.getSnapshot();
  const records = Object.values(snapshot.findingHistory)
    .filter((record) => (options.suppressedOnly ? (record.suppressed ?? false) : true))
    .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));

  if (records.length === 0) {
    deps.log(
      options.suppressedOnly
        ? 'No suppressed findings found.'
        : 'No findings in memory store. Run dramaturge first to populate history.'
    );
    return 0;
  }

  deps.log(
    'SIGNATURE'.padEnd(14) +
      '  ' +
      'SEVERITY'.padEnd(9) +
      'CATEGORY'.padEnd(22) +
      'LAST SEEN '.padEnd(12) +
      'RUNS'.padEnd(6) +
      'SUPPR.'.padEnd(8) +
      'TITLE'
  );

  for (const record of records) {
    const shortSig = record.signature.slice(0, 12) + '..';
    const suppressedMark = record.suppressed ? 'yes' : 'no';
    deps.log(
      shortSig.padEnd(14) +
        '  ' +
        record.severity.padEnd(9) +
        record.category.padEnd(22) +
        formatDate(record.lastSeenAt).padEnd(12) +
        String(record.runCount).padEnd(6) +
        suppressedMark.padEnd(8) +
        record.title
    );
  }
  return 0;
}

function findRecordBySignature(
  snapshotRecords: Record<string, HistoricalFindingRecord>,
  identifier: string
): HistoricalFindingRecord | undefined {
  if (snapshotRecords[identifier]) return snapshotRecords[identifier];
  const prefixMatches = Object.values(snapshotRecords).filter((record) =>
    record.signature.startsWith(identifier)
  );
  if (prefixMatches.length === 1) return prefixMatches[0];
  return undefined;
}

function suppressFinding(
  deps: TriageDependencies,
  paths: ResolvedTriagePaths,
  identifier: string,
  reason: string
): number {
  const store = new MemoryStore(paths.memoryDir);
  const snapshot = store.getSnapshot();
  const record = findRecordBySignature(snapshot.findingHistory, identifier);
  if (!record) {
    deps.error(`No finding matching signature: ${identifier}`);
    return 1;
  }
  store.markFindingSuppressed(record.signature, reason);
  deps.log(`Suppressed: ${record.title}`);
  deps.log(`  reason: ${reason}`);
  return 0;
}

function unsuppressFinding(
  deps: TriageDependencies,
  paths: ResolvedTriagePaths,
  identifier: string
): number {
  const store = new MemoryStore(paths.memoryDir);
  const snapshot = store.getSnapshot();
  const record = findRecordBySignature(snapshot.findingHistory, identifier);
  if (!record) {
    deps.error(`No finding matching signature: ${identifier}`);
    return 1;
  }
  if (!record.suppressed) {
    deps.log(`Finding was not suppressed: ${record.title}`);
    return 0;
  }
  store.unsuppressFinding(record.signature);
  deps.log(`Unsuppressed: ${record.title}`);
  return 0;
}

function listBaselines(deps: TriageDependencies, paths: ResolvedTriagePaths): number {
  const files = listBaselineFiles(paths.baselineDir);
  if (files.length === 0) {
    deps.log(`No visual baselines found in ${paths.baselineDir}.`);
    return 0;
  }
  deps.log('FINGERPRINT'.padEnd(18) + 'SIZE'.padEnd(12) + 'DIMENSIONS'.padEnd(14) + 'MODIFIED');
  for (const file of files) {
    const dims = file.width && file.height ? `${file.width}x${file.height}` : '—';
    const shortHash = file.fingerprintHash.slice(0, 16);
    const size = `${(file.sizeBytes / 1024).toFixed(1)}KB`;
    deps.log(
      shortHash.padEnd(18) + size.padEnd(12) + dims.padEnd(14) + formatDate(file.modifiedAt)
    );
  }
  return 0;
}

function approveBaselinesCommand(
  deps: TriageDependencies,
  paths: ResolvedTriagePaths,
  target: 'all' | string[]
): number {
  if (!existsSync(paths.baselineDir)) {
    deps.log(`No visual baselines found in ${paths.baselineDir}.`);
    return 0;
  }

  const { removed, notFound } = approveBaselines(paths.baselineDir, target);
  if (target === 'all') {
    deps.log(`Removed ${removed.length} baseline(s). Next run will capture fresh baselines.`);
    return 0;
  }

  for (const file of removed) {
    deps.log(`Approved (removed) ${file.fileName}`);
  }
  for (const missing of notFound) {
    deps.error(`No baseline matching: ${missing}`);
  }
  deps.log(
    `Removed ${removed.length} baseline(s). Next run will capture fresh baselines for those pages.`
  );
  return notFound.length > 0 ? 1 : 0;
}

function memoryStats(deps: TriageDependencies, paths: ResolvedTriagePaths): number {
  const store = new MemoryStore(paths.memoryDir);
  const snapshot = store.getSnapshot();
  const findings = Object.values(snapshot.findingHistory);
  const suppressed = findings.filter((record) => record.suppressed).length;
  const baselines = listBaselineFiles(paths.baselineDir);

  deps.log(`Memory store: ${paths.memoryDir}`);
  if (!existsSync(`${paths.memoryDir}/memory.json`)) {
    deps.log('  (no memory.json present — has dramaturge been run with memory enabled?)');
  } else {
    deps.log(`  updated: ${snapshot.updatedAt}`);
  }
  deps.log('');
  deps.log('Findings:');
  deps.log(`  total history entries: ${findings.length}`);
  deps.log(`  suppressed:            ${suppressed}`);
  deps.log('');
  deps.log('Flaky pages:');
  deps.log(`  total tracked: ${snapshot.flakyPages.length}`);
  deps.log('');
  deps.log('Observed API catalog:');
  deps.log(`  endpoints: ${snapshot.observedApiCatalog.length}`);
  deps.log('');
  deps.log(`Visual baselines (${paths.baselineDir}):`);
  deps.log(`  files: ${baselines.length}`);
  return 0;
}

export interface TriageCommandArgs {
  command: 'findings' | 'baselines' | 'memory';
  subcommand: string;
  flags: {
    suppressed?: boolean;
    all?: boolean;
    reason?: string;
  };
  positional: string[];
  configPath?: string;
}

export function runTriageCommand(args: TriageCommandArgs, deps: TriageDependencies): number {
  const paths = resolveTriagePaths(deps.cwd, args.configPath);

  if (args.command === 'findings') {
    switch (args.subcommand) {
      case 'list':
        return listFindings(deps, paths, { suppressedOnly: args.flags.suppressed ?? false });
      case 'suppress': {
        const target = args.positional[0];
        if (!target) {
          deps.error('Usage: dramaturge findings suppress <signature> [--reason <text>]');
          return 1;
        }
        return suppressFinding(deps, paths, target, args.flags.reason ?? 'Manually suppressed');
      }
      case 'unsuppress': {
        const target = args.positional[0];
        if (!target) {
          deps.error('Usage: dramaturge findings unsuppress <signature>');
          return 1;
        }
        return unsuppressFinding(deps, paths, target);
      }
      default:
        deps.error(`Unknown findings subcommand: ${args.subcommand}`);
        return 1;
    }
  }

  if (args.command === 'baselines') {
    switch (args.subcommand) {
      case 'list':
        return listBaselines(deps, paths);
      case 'approve': {
        if (args.flags.all) return approveBaselinesCommand(deps, paths, 'all');
        if (args.positional.length === 0) {
          deps.error('Usage: dramaturge baselines approve [--all | <fingerprint-or-filename>...]');
          return 1;
        }
        return approveBaselinesCommand(deps, paths, args.positional);
      }
      default:
        deps.error(`Unknown baselines subcommand: ${args.subcommand}`);
        return 1;
    }
  }

  if (args.command === 'memory') {
    if (args.subcommand !== 'stats') {
      deps.error(`Unknown memory subcommand: ${args.subcommand}`);
      return 1;
    }
    return memoryStats(deps, paths);
  }

  deps.error(`Unknown triage command: ${args.command}`);
  return 1;
}
