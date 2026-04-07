import { shortId } from '../constants.js';
import { buildAutoCaptureFindingMeta } from '../repro/repro.js';
import type { Evidence, FindingSeverity, RawFinding } from '../types.js';
import type { ObservedApiEndpoint, ObservedApiRequestSample } from '../network/traffic-observer.js';
import {
  matchContractOperation,
  matchContractOperationsForRoute,
  type ContractIndex,
  validateOperationResponse,
} from '../spec/contract-index.js';

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort();
}

function uniqueNumbers(values: number[]): number[] {
  return [...new Set(values)].sort((left, right) => left - right);
}

function normalizeRoute(route: string): string {
  try {
    return new URL(route).pathname;
  } catch {
    return route;
  }
}

interface ObservedMethodSlice {
  method: string;
  statuses: number[];
  failures: string[];
  responses: Array<{ status: number; body?: unknown }>;
}

function buildObservedMethodSlices(observed: ObservedApiEndpoint): ObservedMethodSlice[] {
  if (observed.samples && observed.samples.length > 0) {
    const byMethod = new Map<string, ObservedMethodSlice>();

    for (const sample of observed.samples) {
      const method = sample.method.toUpperCase();
      const entry = byMethod.get(method) ?? {
        method,
        statuses: [],
        failures: [],
        responses: [],
      };
      entry.statuses = uniqueNumbers([...entry.statuses, sample.status]);
      if (sample.failure) {
        entry.failures = uniqueSorted([...entry.failures, sample.failure]);
      }
      if (sample.responseBody !== undefined) {
        entry.responses = dedupeResponses([
          ...entry.responses,
          {
            status: sample.status,
            body: sample.responseBody,
          },
        ]);
      }
      byMethod.set(method, entry);
    }

    return [...byMethod.values()];
  }

  return observed.methods.map((method) => ({
    method,
    statuses: observed.statuses,
    failures: observed.failures,
    responses: observed.responses ?? [],
  }));
}

function dedupeResponses(
  responses: Array<{ status: number; body?: unknown }>
): Array<{ status: number; body?: unknown }> {
  const seen = new Set<string>();
  const unique: Array<{ status: number; body?: unknown }> = [];

  for (const response of responses) {
    const signature = JSON.stringify([response.status, response.body]);
    if (seen.has(signature)) {
      continue;
    }
    seen.add(signature);
    unique.push(response);
  }

  return unique;
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
    return 'Major';
  }

  if (input.unexpectedMethods.length > 0 || input.unexpectedStatuses.length > 0) {
    return 'Minor';
  }

  return 'Trivial';
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
    const methodSlices = buildObservedMethodSlices(observed);

    for (const slice of methodSlices) {
      const routeOperations = input.contractIndex
        ? matchContractOperationsForRoute(input.contractIndex, observed.route)
        : [];
      const contract = input.contractIndex
        ? matchContractOperation(input.contractIndex, slice.method, observed.route)
        : undefined;
      const expectedOperations = contract ? [contract] : routeOperations;
      if (expectedOperations.length === 0) {
        continue;
      }

      const expectedStatuses = contract
        ? Object.keys(contract.responses).map((status) => Number.parseInt(status, 10))
        : [];
      const unexpectedStatuses = contract
        ? slice.statuses.filter((status) => !expectedStatuses.includes(status))
        : [];
      const unexpectedMethods = contract ? [] : [slice.method];
      const schemaErrors = slice.responses.flatMap((response) => {
        if (!contract) {
          return [];
        }
        return [slice.method].flatMap((method) => {
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
        });
      });
      if (
        unexpectedStatuses.length === 0 &&
        unexpectedMethods.length === 0 &&
        slice.failures.length === 0 &&
        schemaErrors.length === 0
      ) {
        continue;
      }

      const evidenceId = `ev-${shortId()}`;
      const findingRef = `fid-${shortId()}`;
      const methods = slice.method || 'ANY';
      const expectedContract = [
        `methods=${uniqueSorted(expectedOperations.map((operation) => operation.method)).join('/') || 'ANY'}`,
        `statuses=${expectedStatuses.join(', ') || 'none'}`,
      ].join('; ');
      const observedContract = [
        `methods=${methods}`,
        `statuses=${slice.statuses.join(', ') || 'none'}`,
        slice.failures.length > 0 ? `failures=${slice.failures.join(' | ')}` : undefined,
        schemaErrors.length > 0 ? `schemaErrors=${schemaErrors.join(' | ')}` : undefined,
      ]
        .filter(Boolean)
        .join('; ');

      evidence.push({
        id: evidenceId,
        type: 'api-contract',
        summary: `${methods} ${observed.route} deviated from repo expectations`,
        timestamp: new Date().toISOString(),
        areaName: input.areaName,
        relatedFindingIds: [findingRef],
      });

      findings.push({
        ref: findingRef,
        category: 'Bug',
        severity: severityForDeviation({
          unexpectedStatuses,
          unexpectedMethods,
          failures: [...slice.failures, ...schemaErrors],
        }),
        title: `API contract deviation: ${methods} ${observed.route}`,
        stepsToReproduce: [`Navigate to ${input.route}`],
        expected: `Contract for ${expectedOperations[0]?.route ?? observed.route}: ${expectedContract}`,
        actual: `Observed API behavior for ${observed.route}: ${observedContract}`,
        evidenceIds: [evidenceId],
        verdict: {
          hypothesis: `The endpoint ${expectedOperations[0]?.route ?? observed.route} should follow the configured contract.`,
          observation: `Observed behavior differed for ${observed.route}.`,
          evidenceChain: uniqueSorted([
            `expected:${expectedContract}`,
            `observed:${observedContract}`,
            ...slice.failures,
            ...schemaErrors,
          ]),
          alternativesConsidered:
            unexpectedStatuses.length === 0 && unexpectedMethods.length === 0
              ? [
                  'The deviation may be caused by transient upstream failures rather than a code-level contract mismatch.',
                ]
              : [],
          suggestedVerification: [
            `Replay ${methods} ${observed.route} and verify the response stays within statuses ${expectedStatuses.join(', ')}.`,
          ],
        },
        meta: buildAutoCaptureFindingMeta({
          route: input.route,
          objective: 'Compare observed API behavior against normalized contract expectations',
          confidence:
            slice.failures.length > 0 ||
            schemaErrors.length > 0 ||
            unexpectedStatuses.some((status) => status >= 500)
              ? 'high'
              : 'medium',
          breadcrumbs: [`api contract check ${methods} ${observed.route}`],
          evidenceIds: [evidenceId],
        }),
      });
    }
  }

  return { findings, evidence };
}
