// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Alex Rambasek

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Evidence, Finding, ReplayableAction, RunResult } from '../types.js';
import { buildFindingGroupKey, collectFindings } from '../report/collector.js';

export interface FindingReplayManifest {
  schemaVersion: 1;
  finding: {
    id: string;
    signature: string;
    category: Finding['category'];
    severity: Finding['severity'];
    title: string;
    expected: string;
    actual: string;
    evidenceTypes: Evidence['type'][];
  };
  origin: {
    runStartedAt: string;
    targetUrl: string;
    route?: string;
    authProfile?: string;
  };
  replay: {
    actions: ReplayableAction[];
    breadcrumbs: string[];
    objective: string;
    maxStepsBudget: number;
  };
  oracles: {
    consoleErrorFragments?: string[];
    networkFailures?: Array<{ urlPattern: string; status: number }>;
    a11yRuleIds?: string[];
    visualBaselineRef?: string;
  };
}

export interface FindingReplayManifestOptions {
  authProfile?: string;
}

function manifestFileName(findingId: string): string {
  return `${findingId.replace(/[^A-Za-z0-9_.-]/g, '_')}.json`;
}

function uniqueValues<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

function collectEvidenceForFinding(result: RunResult, finding: Finding): Evidence[] {
  const wantedIds = new Set([
    ...(finding.evidenceIds ?? []),
    ...finding.occurrences.flatMap((occurrence) => occurrence.evidenceIds),
    ...(finding.meta?.repro?.evidenceIds ?? []),
  ]);
  if (wantedIds.size === 0) return [];

  return result.areaResults.flatMap((area) =>
    area.evidence.filter((evidence) => wantedIds.has(evidence.id))
  );
}

function collectActionsForFinding(result: RunResult, finding: Finding): ReplayableAction[] {
  const actionIds = new Set(finding.meta?.repro?.actionIds ?? []);
  const allAreaActions = result.areaResults.flatMap((area) => area.replayableActions ?? []);
  const ledgerActions =
    result.explorationLedger?.events.flatMap((event) =>
      event.kind === 'action' ? [event.action] : []
    ) ?? [];
  const allActions = [...allAreaActions, ...ledgerActions];

  if (actionIds.size > 0) {
    const matched = allActions.filter((action) => actionIds.has(action.id));
    return uniqueActions(matched);
  }

  return [];
}

function uniqueActions(actions: ReplayableAction[]): ReplayableAction[] {
  const seen = new Set<string>();
  const unique: ReplayableAction[] = [];
  for (const action of actions) {
    if (seen.has(action.id)) continue;
    seen.add(action.id);
    unique.push(action);
  }
  return unique;
}

function extractNetworkFailure(
  summary: string
): { urlPattern: string; status: number } | undefined {
  const statusMatch = /\b([1-5][0-9]{2})\b/.exec(summary);
  if (!statusMatch) return undefined;
  const urlMatch = /(https?:\/\/\S+|\/[\w./:?-]+)/.exec(summary);
  return {
    urlPattern: urlMatch?.[1] ?? summary.slice(0, 120),
    status: Number.parseInt(statusMatch[1], 10),
  };
}

function buildOracles(evidence: Evidence[]): FindingReplayManifest['oracles'] {
  const consoleErrorFragments = uniqueValues(
    evidence
      .filter((item) => item.type === 'console-error')
      .map((item) => item.summary)
      .filter((summary) => summary.length > 0)
  );
  const networkFailures = evidence
    .filter((item) => item.type === 'network-error')
    .map((item) => extractNetworkFailure(item.summary))
    .filter((item): item is { urlPattern: string; status: number } => Boolean(item));
  const a11yRuleIds = uniqueValues(
    evidence
      .filter((item) => item.type === 'accessibility-scan')
      .map((item) => /accessibility rule ([\w-]+)/i.exec(item.summary)?.[1])
      .filter((ruleId): ruleId is string => Boolean(ruleId))
  );
  const visualBaselineRef = evidence.find((item) => item.type === 'visual-diff')?.path;
  return {
    ...(consoleErrorFragments.length > 0 ? { consoleErrorFragments } : {}),
    ...(networkFailures.length > 0 ? { networkFailures } : {}),
    ...(a11yRuleIds.length > 0 ? { a11yRuleIds } : {}),
    ...(visualBaselineRef ? { visualBaselineRef } : {}),
  };
}

export function buildFindingReplayManifest(
  result: RunResult,
  finding: Finding,
  options: FindingReplayManifestOptions = {}
): FindingReplayManifest {
  const evidence = collectEvidenceForFinding(result, finding);
  const actions = collectActionsForFinding(result, finding);
  const route = finding.meta?.repro?.route ?? finding.occurrences.find((item) => item.route)?.route;

  return {
    schemaVersion: 1,
    finding: {
      id: finding.id,
      signature: buildFindingGroupKey(finding),
      category: finding.category,
      severity: finding.severity,
      title: finding.title,
      expected: finding.expected,
      actual: finding.actual,
      evidenceTypes: uniqueValues(evidence.map((item) => item.type)),
    },
    origin: {
      runStartedAt: result.startTime.toISOString(),
      targetUrl: result.targetUrl,
      ...(route ? { route } : {}),
      ...(options.authProfile ? { authProfile: options.authProfile } : {}),
    },
    replay: {
      actions,
      breadcrumbs: finding.meta?.repro?.breadcrumbs ?? finding.stepsToReproduce,
      objective: finding.meta?.repro?.objective ?? `Confirm ${finding.id}: ${finding.title}`,
      maxStepsBudget: Math.max(actions.length, 1),
    },
    oracles: buildOracles(evidence),
  };
}

export function buildFindingReplayManifests(
  result: RunResult,
  options: FindingReplayManifestOptions = {}
): FindingReplayManifest[] {
  return collectFindings(result.areaResults).map((finding) =>
    buildFindingReplayManifest(result, finding, options)
  );
}

export function writeFindingReplayManifests(
  outputDir: string,
  result: RunResult,
  options: FindingReplayManifestOptions = {}
): string[] {
  const manifests = buildFindingReplayManifests(result, options);
  if (manifests.length === 0) return [];

  const findingsDir = join(outputDir, 'findings');
  mkdirSync(findingsDir, { recursive: true });
  const paths: string[] = [];
  for (const manifest of manifests) {
    const path = join(findingsDir, manifestFileName(manifest.finding.id));
    writeFileSync(path, JSON.stringify(manifest, null, 2), 'utf-8');
    paths.push(path);
  }
  return paths;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function parseManifest(value: unknown): FindingReplayManifest {
  if (!isObject(value) || value.schemaVersion !== 1 || !isObject(value.finding)) {
    throw new Error('Invalid finding replay manifest: expected schemaVersion 1');
  }
  const id = value.finding.id;
  if (!isString(id) || id.length === 0) {
    throw new Error('Invalid finding replay manifest: missing finding.id');
  }
  return value as unknown as FindingReplayManifest;
}

export function readFindingReplayManifest(path: string): FindingReplayManifest {
  return parseManifest(JSON.parse(readFileSync(path, 'utf-8')) as unknown);
}

export function loadFindingReplayManifest(
  reportDir: string,
  findingId: string
): FindingReplayManifest {
  const path = join(reportDir, 'findings', manifestFileName(findingId));
  if (!existsSync(path)) {
    throw new Error(
      `No replay manifest found for ${findingId}. Expected ${path}. Re-run Dramaturge to emit findings/<id>.json manifests.`
    );
  }
  return readFindingReplayManifest(path);
}
