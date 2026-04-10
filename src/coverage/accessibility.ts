// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Alex Rambasek

import { buildAutoCaptureFindingMeta } from "../repro/repro.js";
import { shortId } from "../constants.js";
import type { Evidence, FindingSeverity, RawFinding } from "../types.js";

interface AccessibilityNodeResult {
  target: unknown[];
  failureSummary?: string;
}

interface AccessibilityViolation {
  id: string;
  impact?: string | null;
  help: string;
  helpUrl?: string;
  nodes: AccessibilityNodeResult[];
}

interface AccessibilityScanResults {
  violations: AccessibilityViolation[];
}

export function mapAxeImpactToSeverity(impact?: string | null): FindingSeverity {
  switch (impact) {
    case "critical":
      return "Critical";
    case "serious":
      return "Major";
    case "minor":
      return "Trivial";
    case "moderate":
    default:
      return "Minor";
  }
}

export function buildAccessibilityArtifacts(input: {
  areaName: string;
  route: string;
  violations: AccessibilityViolation[];
}): { findings: RawFinding[]; evidence: Evidence[] } {
  const findings: RawFinding[] = [];
  const evidence: Evidence[] = [];

  for (const violation of input.violations) {
    const evidenceId = `ev-${shortId()}`;
    const findingRef = `fid-${shortId()}`;
    const selectors = violation.nodes.flatMap((node) =>
      node.target.map((target) => (typeof target === "string" ? target : JSON.stringify(target)))
    );
    const selectorSummary = selectors.slice(0, 3).join(", ");
    const failureSummary = violation.nodes
      .map((node) => node.failureSummary)
      .filter((summary): summary is string => Boolean(summary));
    const evidenceChain = [
      ...selectors,
      ...failureSummary,
      ...(violation.helpUrl ? [violation.helpUrl] : []),
    ];

    evidence.push({
      id: evidenceId,
      type: "accessibility-scan",
      summary: `${violation.impact ?? "moderate"}: ${violation.help}`,
      timestamp: new Date().toISOString(),
      areaName: input.areaName,
      relatedFindingIds: [findingRef],
    });

    findings.push({
      ref: findingRef,
      category: "Accessibility Issue",
      severity: mapAxeImpactToSeverity(violation.impact),
      title: `A11y: ${violation.help}`,
      stepsToReproduce: [`Navigate to ${input.route}`],
      expected: `Page should satisfy accessibility rule ${violation.id}`,
      actual: `${violation.nodes.length} element(s) violated ${violation.help}`,
      evidenceIds: [evidenceId],
      verdict: {
        hypothesis: `The page should satisfy the accessibility rule ${violation.id}.`,
        observation: `${violation.nodes.length} element(s) violated the rule ${violation.help}.`,
        evidenceChain,
        alternativesConsidered: [],
        suggestedVerification: selectorSummary
          ? [`Inspect the affected elements: ${selectorSummary}`]
          : [`Re-run axe-core on ${input.route}`],
      },
      meta: buildAutoCaptureFindingMeta({
        route: input.route,
        objective: "Observe deterministic accessibility scan results",
        confidence: "high",
        breadcrumbs: [`auto-captured accessibility violation ${violation.id}`],
        evidenceIds: [evidenceId],
      }),
    });
  }

  return { findings, evidence };
}

/**
 * Analyze accessibility using axe-core.
 * @param page - Page object (Playwright or Stagehand Page). Uses `any` to accommodate both.
 */
async function analyzeAccessibilityPage(page: any): Promise<AccessibilityScanResults> {
  const module = await import("@axe-core/playwright");
  const AxeBuilder = module.AxeBuilder;
  const results = await new AxeBuilder({ page }).analyze();
  return {
    violations: results.violations ?? [],
  };
}

/**
 * Run accessibility scan and produce findings + evidence.
 * @param page - Page object (Playwright or Stagehand Page). Uses `any` to accommodate both.
 * @param areaName - Name of the area being scanned
 * @param route - Route being scanned
 * @param analyze - Optional custom analyzer function
 */
export async function runAccessibilityScan(
  page: any,
  areaName: string,
  route: string,
  analyze: (page: any) => Promise<AccessibilityScanResults> = analyzeAccessibilityPage
): Promise<{ findings: RawFinding[]; evidence: Evidence[] }> {
  try {
    const results = await analyze(page);
    return buildAccessibilityArtifacts({
      areaName,
      route,
      violations: results.violations,
    });
  } catch (error) {
    // Accessibility scan is best-effort; axe-core may not be available or may fail
    return { findings: [], evidence: [] };
  }
}
