import { shortId } from "../constants.js";
import { buildAutoCaptureFindingMeta } from "../repro/repro.js";
import type { RepoHints, ApiEndpointHint } from "../adaptation/types.js";
import type { Evidence, FindingSeverity, RawFinding } from "../types.js";
import type { ObservedApiEndpoint } from "../network/traffic-observer.js";

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort();
}

function normalizeRoute(route: string): string {
  try {
    return new URL(route).pathname;
  } catch {
    return route;
  }
}

function routeMatchesHint(observedRoute: string, hintedRoute: string): boolean {
  const observedSegments = normalizeRoute(observedRoute).split("/").filter(Boolean);
  const hintedSegments = normalizeRoute(hintedRoute).split("/").filter(Boolean);

  if (observedSegments.length !== hintedSegments.length) {
    return false;
  }

  return hintedSegments.every((segment, index) => {
    if (/^\[[^\]]+\]$/.test(segment)) {
      return observedSegments[index].length > 0;
    }
    return segment === observedSegments[index];
  });
}

function findEndpointHint(
  observedRoute: string,
  repoHints?: RepoHints
): ApiEndpointHint | undefined {
  if (!repoHints) {
    return undefined;
  }

  return repoHints.apiEndpoints.find((hint) => routeMatchesHint(observedRoute, hint.route));
}

function severityForDeviation(input: {
  unexpectedStatuses: number[];
  unexpectedMethods: string[];
  failures: string[];
}): FindingSeverity {
  if (
    input.failures.length > 0 ||
    input.unexpectedStatuses.some((status) => status === 0 || status >= 500)
  ) {
    return "Major";
  }

  if (input.unexpectedMethods.length > 0 || input.unexpectedStatuses.length > 0) {
    return "Minor";
  }

  return "Trivial";
}

export function buildApiContractArtifacts(input: {
  areaName: string;
  route: string;
  observedEndpoints: ObservedApiEndpoint[];
  repoHints?: RepoHints;
}): { findings: RawFinding[]; evidence: Evidence[] } {
  const findings: RawFinding[] = [];
  const evidence: Evidence[] = [];

  for (const observed of input.observedEndpoints) {
    const hinted = findEndpointHint(observed.route, input.repoHints);
    if (!hinted) {
      continue;
    }

    const unexpectedStatuses = observed.statuses.filter(
      (status) => !hinted.statuses.includes(status)
    );
    const unexpectedMethods = observed.methods.filter(
      (method) => !hinted.methods.includes(method)
    );
    if (
      unexpectedStatuses.length === 0 &&
      unexpectedMethods.length === 0 &&
      observed.failures.length === 0
    ) {
      continue;
    }

    const evidenceId = `ev-${shortId()}`;
    const findingRef = `fid-${shortId()}`;
    const methods = observed.methods.join("/") || "ANY";
    const expectedContract = [
      `methods=${hinted.methods.join("/") || "ANY"}`,
      `statuses=${hinted.statuses.join(", ") || "none"}`,
    ].join("; ");
    const observedContract = [
      `methods=${observed.methods.join("/") || "ANY"}`,
      `statuses=${observed.statuses.join(", ") || "none"}`,
      observed.failures.length > 0
        ? `failures=${observed.failures.join(" | ")}`
        : undefined,
    ]
      .filter(Boolean)
      .join("; ");

    evidence.push({
      id: evidenceId,
      type: "api-contract",
      summary: `${methods} ${observed.route} deviated from repo expectations`,
      timestamp: new Date().toISOString(),
      areaName: input.areaName,
      relatedFindingIds: [findingRef],
    });

    findings.push({
      ref: findingRef,
      category: "Bug",
      severity: severityForDeviation({
        unexpectedStatuses,
        unexpectedMethods,
        failures: observed.failures,
      }),
      title: `API contract deviation: ${methods} ${observed.route}`,
      stepsToReproduce: [`Navigate to ${input.route}`],
      expected: `Repo-derived contract for ${hinted.route}: ${expectedContract}`,
      actual: `Observed API behavior for ${observed.route}: ${observedContract}`,
      evidenceIds: [evidenceId],
      verdict: {
        hypothesis: `The endpoint ${hinted.route} should follow the repo-derived contract.`,
        observation: `Observed behavior differed for ${observed.route}.`,
        evidenceChain: uniqueSorted([
          `expected:${expectedContract}`,
          `observed:${observedContract}`,
          ...observed.failures,
        ]),
        alternativesConsidered: unexpectedStatuses.length === 0 && unexpectedMethods.length === 0
          ? ["The deviation may be caused by transient upstream failures rather than a code-level contract mismatch."]
          : [],
        suggestedVerification: [
          `Replay ${methods} ${observed.route} and verify the response stays within statuses ${hinted.statuses.join(", ")}.`,
        ],
      },
      meta: buildAutoCaptureFindingMeta({
        route: input.route,
        objective: "Compare observed API behavior against repo-derived expectations",
        confidence:
          observed.failures.length > 0 ||
          unexpectedStatuses.some((status) => status >= 500)
            ? "high"
            : "medium",
        breadcrumbs: [`api contract check ${methods} ${observed.route}`],
        evidenceIds: [evidenceId],
      }),
    });
  }

  return { findings, evidence };
}
