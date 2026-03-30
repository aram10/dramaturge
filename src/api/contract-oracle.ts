import { shortId } from "../constants.js";
import { buildAutoCaptureFindingMeta } from "../repro/repro.js";
import type { Evidence, FindingSeverity, RawFinding } from "../types.js";
import type { ObservedApiEndpoint } from "../network/traffic-observer.js";
import {
  matchContractOperation,
  type ContractIndex,
  validateOperationResponse,
} from "../spec/contract-index.js";

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
  contractIndex?: ContractIndex;
}): { findings: RawFinding[]; evidence: Evidence[] } {
  const findings: RawFinding[] = [];
  const evidence: Evidence[] = [];

  for (const observed of input.observedEndpoints) {
    const matchingOperations = observed.methods
      .map((method) =>
        input.contractIndex
          ? matchContractOperation(input.contractIndex, method, observed.route)
          : undefined
      )
      .filter((operation): operation is NonNullable<typeof operation> => Boolean(operation));
    const contract = matchingOperations[0];
    if (!contract) {
      continue;
    }

    const expectedStatuses = Object.keys(contract.responses).map((status) => Number.parseInt(status, 10));
    const unexpectedStatuses = observed.statuses.filter(
      (status) => !expectedStatuses.includes(status)
    );
    const unexpectedMethods = observed.methods.filter(
      (method) => !matchingOperations.some((operation) => operation.method === method)
    );
    const schemaErrors =
      observed.responses?.flatMap((response) =>
        observed.methods.flatMap((method) => {
          const validation = input.contractIndex
            ? validateOperationResponse(
                input.contractIndex,
                method,
                observed.route,
                response.status,
                response.body
              )
            : undefined;

          if (!validation || validation.ok || !validation.statusAllowed) {
            return [];
          }

          return validation.errors.map(
            (error) => `Schema validation failed for ${response.status}: ${error}`
          );
        })
      ) ?? [];
    if (
      unexpectedStatuses.length === 0 &&
      unexpectedMethods.length === 0 &&
      observed.failures.length === 0 &&
      schemaErrors.length === 0
    ) {
      continue;
    }

    const evidenceId = `ev-${shortId()}`;
    const findingRef = `fid-${shortId()}`;
    const methods = observed.methods.join("/") || "ANY";
    const expectedContract = [
      `methods=${uniqueSorted(matchingOperations.map((operation) => operation.method)).join("/") || "ANY"}`,
      `statuses=${expectedStatuses.join(", ") || "none"}`,
    ].join("; ");
    const observedContract = [
      `methods=${observed.methods.join("/") || "ANY"}`,
      `statuses=${observed.statuses.join(", ") || "none"}`,
      observed.failures.length > 0
        ? `failures=${observed.failures.join(" | ")}`
        : undefined,
      schemaErrors.length > 0 ? `schemaErrors=${schemaErrors.join(" | ")}` : undefined,
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
        failures: [...observed.failures, ...schemaErrors],
      }),
      title: `API contract deviation: ${methods} ${observed.route}`,
      stepsToReproduce: [`Navigate to ${input.route}`],
      expected: `Contract for ${contract.route}: ${expectedContract}`,
      actual: `Observed API behavior for ${observed.route}: ${observedContract}`,
      evidenceIds: [evidenceId],
      verdict: {
        hypothesis: `The endpoint ${contract.route} should follow the configured contract.`,
        observation: `Observed behavior differed for ${observed.route}.`,
        evidenceChain: uniqueSorted([
          `expected:${expectedContract}`,
          `observed:${observedContract}`,
          ...observed.failures,
          ...schemaErrors,
        ]),
        alternativesConsidered: unexpectedStatuses.length === 0 && unexpectedMethods.length === 0
          ? ["The deviation may be caused by transient upstream failures rather than a code-level contract mismatch."]
          : [],
        suggestedVerification: [
          `Replay ${methods} ${observed.route} and verify the response stays within statuses ${expectedStatuses.join(", ")}.`,
        ],
      },
      meta: buildAutoCaptureFindingMeta({
        route: input.route,
        objective: "Compare observed API behavior against normalized contract expectations",
        confidence:
          observed.failures.length > 0 ||
          schemaErrors.length > 0 ||
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
