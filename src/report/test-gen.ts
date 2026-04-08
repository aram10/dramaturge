import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ReplayableAction, RunResult } from '../types.js';
import { collectFindings } from './collector.js';
import { inferAssertions } from './assertion-inference.js';

export interface GeneratedPlaywrightTest {
  filename: string;
  content: string;
}

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
        : `// ${action.summary}`;
    case 'input':
      if (!action.selector) {
        return `// ${action.summary}`;
      }
      if (action.redacted) {
        return `// ${action.summary} (redacted value omitted)`;
      }
      if (action.value != null) {
        return `await page.locator(${escapeString(action.selector)}).fill(${escapeString(action.value)});`;
      }
      return `// ${action.summary}`;
    case 'keydown':
      return action.key
        ? `await page.keyboard.press(${escapeString(action.key)});`
        : `// ${action.summary}`;
    default:
      return `// ${action.summary}`;
  }
}

export function generatePlaywrightTests(result: RunResult): GeneratedPlaywrightTest[] {
  const findings = collectFindings(result.areaResults);
  const areaActions = new Map(
    result.areaResults.map((area) => [area.name, area.replayableActions ?? []] as const)
  );

  return findings
    .filter((finding) => finding.meta?.repro)
    .map((finding) => {
      const area = result.areaResults.find((candidate) => candidate.name === finding.area);
      const availableActions = areaActions.get(finding.area) ?? [];
      const actionIds = new Set(finding.meta?.repro?.actionIds ?? []);
      const selectedActions =
        actionIds.size > 0
          ? availableActions.filter((action) => actionIds.has(action.id))
          : availableActions;
      const renderedActions = selectedActions
        .map((action) => renderAction(action))
        .filter((line): line is string => Boolean(line));
      const route = finding.meta?.repro?.route ?? area?.url ?? result.targetUrl;
      const filename = `${finding.id.toLowerCase()}-${slugify(finding.title)}.spec.ts`;
      const breadcrumbs = finding.meta?.repro?.breadcrumbs ?? [];

      // Resolve evidence types linked to this finding across all impacted areas.
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

      const preambles = assertions.filter((a) => a.preamble).map((a) => a.preamble!);

      const lines = [
        'import { test, expect } from "@playwright/test";',
        '',
        `test(${escapeString(`${finding.id}: ${finding.title}`)}, async ({ page }) => {`,
        `  // Expected: ${finding.expected.replace(/[\r\n]+/g, ' ')}`,
        `  // Actual: ${finding.actual.replace(/[\r\n]+/g, ' ')}`,
      ];

      // Preamble code (event listeners) must appear before navigation to capture all events.
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
          lines.push(`  // - ${breadcrumb.replace(/[\r\n]+/g, ' ')}`);
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

      return {
        filename,
        content: `${lines.join('\n')}\n`,
      };
    });
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
