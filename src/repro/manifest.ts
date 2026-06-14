// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Alex Rambasek

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
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

/**
 * Derive a network-failure oracle for a network-error evidence item. Prefers
 * the structured `network` field captured at observation time (#251); only
 * falls back to regex-parsing the human-readable summary for older evidence
 * that predates structured capture.
 */
function networkFailureFromEvidence(
  item: Evidence
): { urlPattern: string; status: number } | undefined {
  if (item.network) {
    return { urlPattern: item.network.url, status: item.network.status };
  }
  return extractNetworkFailure(item.summary);
}

function buildOracles(finding: Finding, evidence: Evidence[]): FindingReplayManifest['oracles'] {
  const consoleErrorFragments = uniqueValues(
    evidence
      .filter((item) => item.type === 'console-error')
      .map((item) => item.summary)
      .filter((summary) => summary.length > 0)
  );
  const networkFailures = evidence
    .filter((item) => item.type === 'network-error')
    .map((item) => networkFailureFromEvidence(item))
    .filter((item): item is { urlPattern: string; status: number } => Boolean(item));
  const findingA11yRuleId = /accessibility rule ([\w-]+)/i.exec(finding.expected)?.[1];
  const a11yRuleIds = uniqueValues(
    [
      ...evidence
        .filter((item) => item.type === 'accessibility-scan')
        .map((item) => /accessibility rule ([\w-]+)/i.exec(item.summary)?.[1])
        .filter((ruleId): ruleId is string => Boolean(ruleId)),
      ...(findingA11yRuleId ? [findingA11yRuleId] : []),
    ].filter((ruleId): ruleId is string => Boolean(ruleId))
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
    oracles: buildOracles(finding, evidence),
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

const ReplayActionSchema = z.object({
  id: z.string().min(1),
  kind: z.string().min(1),
  summary: z.string(),
  source: z.enum(['page', 'worker-tool']),
  status: z.string().min(1),
  timestamp: z.string().min(1),
  selector: z.string().optional(),
  url: z.string().optional(),
  value: z.string().optional(),
  redacted: z.boolean().optional(),
  key: z.string().optional(),
});

const FindingReplayManifestSchema = z.object({
  schemaVersion: z.literal(1),
  finding: z.object({
    id: z.string().min(1),
    signature: z.string().min(1),
    category: z.string().min(1),
    severity: z.string().min(1),
    title: z.string(),
    expected: z.string(),
    actual: z.string(),
    evidenceTypes: z.array(z.string().min(1)),
  }),
  origin: z.object({
    runStartedAt: z.string().min(1),
    targetUrl: z.string().min(1),
    route: z.string().optional(),
    authProfile: z.string().optional(),
  }),
  replay: z.object({
    actions: z.array(ReplayActionSchema),
    breadcrumbs: z.array(z.string()),
    objective: z.string().min(1),
    maxStepsBudget: z.number().int().nonnegative(),
  }),
  oracles: z.object({
    consoleErrorFragments: z.array(z.string()).optional(),
    networkFailures: z
      .array(
        z.object({
          urlPattern: z.string().min(1),
          status: z.number().int(),
        })
      )
      .optional(),
    a11yRuleIds: z.array(z.string().min(1)).optional(),
    visualBaselineRef: z.string().min(1).optional(),
  }),
});

function formatZodIssuePath(path: PropertyKey[]): string {
  return path
    .map((segment) =>
      typeof segment === 'number'
        ? `[${segment}]`
        : typeof segment === 'string'
          ? segment
          : String(segment)
    )
    .join('.');
}

function parseManifest(value: unknown): FindingReplayManifest {
  const parsed = FindingReplayManifestSchema.safeParse(value);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    const path = formatZodIssuePath(firstIssue.path);
    throw new Error(
      `Invalid finding replay manifest: ${path ? `${path}: ` : ''}${firstIssue.message}`
    );
  }
  return parsed.data as FindingReplayManifest;
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
