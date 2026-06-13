// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Alex Rambasek

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  ReplayableAction,
  RunResult,
  ExplorationLedgerEvent,
  ExplorationLedgerActionEvent,
} from '../types.js';
import { collectFindings } from './collector.js';
import { inferAssertions } from './assertion-inference.js';

export interface GeneratedPlaywrightTest {
  filename: string;
  content: string;
}

type CollectedFinding = ReturnType<typeof collectFindings>[number];
type InferredAssertion = ReturnType<typeof inferAssertions>[number];

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function escapeString(value: string): string {
  return JSON.stringify(value);
}

function renderAction(action: ReplayableAction): string | null {
  switch (action.kind) {
    case 'navigate':
      return action.url ? `await page.goto(${escapeString(action.url)});` : null;
    case 'click':
    case 'toggle':
    case 'submit':
    case 'open':
    case 'close':
      return action.selector
        ? `await page.locator(${escapeString(action.selector)}).click();`
        : `// ${sanitizeCommentText(action.summary)}`;
    case 'input':
      if (action.redacted) {
        return `// ${sanitizeCommentText(action.summary)} (redacted value omitted)`;
      }
      if (!action.selector) {
        return `// ${sanitizeCommentText(action.summary)}`;
      }
      if (action.value != null) {
        return `await page.locator(${escapeString(action.selector)}).fill(${escapeString(action.value)});`;
      }
      return `// ${sanitizeCommentText(action.summary)}`;
    case 'keydown':
      return action.key
        ? `await page.keyboard.press(${escapeString(action.key)});`
        : `// ${sanitizeCommentText(action.summary)}`;
    default:
      return `// ${sanitizeCommentText(action.summary)}`;
  }
}

function isLedgerActionEvent(event: ExplorationLedgerEvent): event is ExplorationLedgerActionEvent {
  return event.kind === 'action';
}

function selectActionsById(
  actions: ReplayableAction[],
  actionIds: ReadonlySet<string>
): ReplayableAction[] {
  if (actionIds.size === 0) {
    return actions;
  }

  return actions.filter((action) => actionIds.has(action.id));
}

function sanitizeCommentText(value: string): string {
  // Collapse any line terminator (including U+2028/U+2029, which terminate lines
  // in JS source) so untrusted text cannot end a `//` comment and inject code.
  return value.replace(/[\r\n\u2028\u2029]+/g, ' ');
}

interface TestFileContext {
  result: RunResult;
  areaActions: Map<string, ReplayableAction[]>;
  ledgerActions: ReplayableAction[];
}

export function buildTestFileContent(
  finding: CollectedFinding,
  ctx: TestFileContext
): GeneratedPlaywrightTest {
  const { result, areaActions, ledgerActions } = ctx;
  const area = result.areaResults.find((candidate) => candidate.name === finding.area);
  const availableActions = areaActions.get(finding.area) ?? [];
  const actionIds = new Set(finding.meta?.repro?.actionIds ?? []);
  const selectedActions = selectActionsById(availableActions, actionIds);
  const selectedLedgerActions = selectActionsById(ledgerActions, actionIds);
  const actionsToRender = selectedActions.length > 0 ? selectedActions : selectedLedgerActions;
  const renderedActions = actionsToRender
    .map((action) => renderAction(action))
    .filter((line): line is string => Boolean(line));
  const route = finding.meta?.repro?.route ?? area?.url ?? result.targetUrl;
  const filename = `${finding.id.toLowerCase()}-${slugify(finding.title)}.spec.ts`;
  const breadcrumbs = finding.meta?.repro?.breadcrumbs ?? [];

  const impactedAreaNames = new Set(finding.impactedAreas);
  const allLinkedEvidence = result.areaResults
    .filter((a) => impactedAreaNames.has(a.name))
    .flatMap((a) => a.evidence);
  const reproEvidenceIds = new Set(finding.meta?.repro?.evidenceIds ?? []);
  const findingEvidenceIds = new Set([...(finding.evidenceIds ?? []), ...reproEvidenceIds]);
  const evidenceTypes = [
    ...new Set(
      allLinkedEvidence
        .filter(
          (e) =>
            findingEvidenceIds.has(e.id) ||
            e.relatedFindingIds.includes(finding.id) ||
            (finding.ref != null && e.relatedFindingIds.includes(finding.ref))
        )
        .map((e) => e.type)
    ),
  ];

  const assertions = inferAssertions({
    title: finding.title,
    expected: finding.expected,
    actual: finding.actual,
    category: finding.category,
    evidenceTypes,
  });

  const preambles = assertions.flatMap((assertion) =>
    assertion.preamble ? [assertion.preamble] : []
  );
  const lines = buildTestBodyLines({
    finding,
    route,
    preambles,
    renderedActions,
    breadcrumbs,
    assertions,
  });
  return { filename, content: `${lines.join('\n')}\n` };
}

interface TestBodyOptions {
  finding: CollectedFinding;
  route: string;
  preambles: string[];
  renderedActions: string[];
  breadcrumbs: string[];
  assertions: InferredAssertion[];
}

function buildTestBodyLines(opts: TestBodyOptions): string[] {
  const { finding, route, preambles, renderedActions, breadcrumbs, assertions } = opts;
  const lines = [
    'import { test, expect } from "@playwright/test";',
    '',
    `test(${escapeString(`${finding.id}: ${finding.title}`)}, async ({ page }) => {`,
    `  // Expected: ${sanitizeCommentText(finding.expected)}`,
    `  // Actual: ${sanitizeCommentText(finding.actual)}`,
  ];
  for (const preamble of preambles) {
    lines.push(`  ${preamble}`);
  }
  lines.push(`  await page.goto(${escapeString(route)});`);
  if (renderedActions.length > 0) {
    for (const action of renderedActions) {
      lines.push(`  ${action}`);
    }
  } else if (breadcrumbs.length > 0) {
    lines.push('  // Breadcrumbs:');
    for (const breadcrumb of breadcrumbs) {
      lines.push(`  // - ${sanitizeCommentText(breadcrumb)}`);
    }
  }
  if (assertions.length > 0) {
    for (const assertion of assertions) {
      lines.push(`  ${assertion.code}`);
    }
  } else {
    lines.push('  // No confident assertion could be inferred automatically.');
  }
  lines.push('});');
  return lines;
}

export function generatePlaywrightTests(result: RunResult): GeneratedPlaywrightTest[] {
  const findings = collectFindings(result.areaResults);
  const areaActions = new Map(
    result.areaResults.map((area) => [area.name, area.replayableActions ?? []] as const)
  );
  const ledgerActions =
    result.explorationLedger?.events.flatMap((event) =>
      isLedgerActionEvent(event) ? [event.action] : []
    ) ?? [];

  const ctx: TestFileContext = { result, areaActions, ledgerActions };
  return findings
    .filter((finding) => finding.meta?.repro)
    .map((finding) => buildTestFileContent(finding, ctx));
}

export function writeGeneratedPlaywrightTests(
  outputDir: string,
  result: RunResult
): GeneratedPlaywrightTest[] {
  const generated = generatePlaywrightTests(result);
  if (generated.length === 0) {
    return [];
  }

  const testsDir = join(outputDir, 'generated-tests');
  mkdirSync(testsDir, { recursive: true });

  for (const testFile of generated) {
    writeFileSync(join(testsDir, testFile.filename), testFile.content, 'utf-8');
  }

  return generated;
}
