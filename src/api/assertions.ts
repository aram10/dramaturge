import { shortId } from "../constants.js";
import { buildConfirmedFindingMeta } from "../repro/repro.js";
import { redactSensitiveValue, truncateString } from "../redaction.js";
import {
  validateOperationResponse,
  type ContractIndex,
} from "../spec/contract-index.js";
import type { Evidence, FindingSeverity, RawFinding } from "../types.js";
import type { ApiProbeTarget, ApiReplayResponse } from "./types.js";

interface ApiAssertionArtifact {
  finding: RawFinding;
  evidence: Evidence;
}

function describeBody(body: unknown): string {
  if (body === undefined) {
    return "no body";
  }

  try {
    const serialized = JSON.stringify(redactSensitiveValue(body));
    return serialized.length > 320 ? `${serialized.slice(0, 317)}...` : serialized;
  } catch {
    return "[Unserializable body]";
  }
}

function severityForStatus(status: number): FindingSeverity {
  if (status >= 500 || status === 0) {
    return "Major";
  }

  return "Minor";
}

export function buildAuthBoundaryFailureArtifacts(input: {
  areaName: string;
  pageRoute: string;
  target: ApiProbeTarget;
  response: ApiReplayResponse;
}): ApiAssertionArtifact | undefined {
  if (input.response.status < 200 || input.response.status >= 300) {
    return undefined;
  }

  const findingRef = `fid-${shortId()}`;
  const evidenceId = `ev-${shortId()}`;
  const title = `Authorization boundary failure: ${input.target.method} ${input.target.route}`;
  const actual = `Unauthenticated probe returned ${input.response.status} with body ${describeBody(input.response.body)}`;

  return {
    evidence: {
      id: evidenceId,
      type: "api-contract",
      summary: `${input.target.method} ${input.target.route} succeeded without authentication`,
      timestamp: new Date().toISOString(),
      areaName: input.areaName,
      relatedFindingIds: [findingRef],
    },
    finding: {
      ref: findingRef,
      category: "Bug",
      severity: "Major",
      title,
      stepsToReproduce: [
        `Open ${input.pageRoute}`,
        `Replay ${input.target.method} ${input.target.route} without authentication`,
      ],
      expected: `The endpoint should reject unauthenticated requests for ${input.target.method} ${input.target.route}.`,
      actual,
      evidenceIds: [evidenceId],
      verdict: {
        hypothesis: `${input.target.method} ${input.target.route} is protected and should require authentication.`,
        observation: `An isolated unauthenticated probe still succeeded with ${input.response.status}.`,
        evidenceChain: [
          `page:${input.pageRoute}`,
          `endpoint:${input.target.method} ${input.target.route}`,
          `status:${input.response.status}`,
        ],
        alternativesConsidered: [
          "The endpoint may intentionally expose public data despite surrounding UI auth requirements.",
        ],
        suggestedVerification: [
          `Verify backend authorization for ${input.target.method} ${input.target.route}.`,
        ],
      },
      meta: buildConfirmedFindingMeta({
        route: input.pageRoute,
        objective: `Probe API auth boundaries related to ${input.areaName}`,
        confidence: "high",
        breadcrumbs: [`api auth probe ${input.target.method} ${input.target.route}`],
        evidenceIds: [evidenceId],
      }),
    },
  };
}

export function buildContractReplayArtifacts(input: {
  areaName: string;
  pageRoute: string;
  target: ApiProbeTarget;
  response: ApiReplayResponse;
  contractIndex?: ContractIndex;
}): ApiAssertionArtifact | undefined {
  if (!input.contractIndex) {
    return undefined;
  }

  const validation = validateOperationResponse(
    input.contractIndex,
    input.target.method,
    input.target.route,
    input.response.status,
    input.response.body
  );

  if (validation.ok || !validation.operation) {
    return undefined;
  }

  const findingRef = `fid-${shortId()}`;
  const evidenceId = `ev-${shortId()}`;
  const title = `API replay contract deviation: ${input.target.method} ${input.target.route}`;
  const expectedStatuses = Object.keys(validation.operation.responses).join(", ") || "none";
  const schemaNote =
    validation.errors.length > 0 ? `; validation errors: ${validation.errors.join(" | ")}` : "";

  return {
    evidence: {
      id: evidenceId,
      type: "api-contract",
      summary: `${input.target.method} ${input.target.route} replay deviated from contract`,
      timestamp: new Date().toISOString(),
      areaName: input.areaName,
      relatedFindingIds: [findingRef],
    },
    finding: {
      ref: findingRef,
      category: "Bug",
      severity: severityForStatus(input.response.status),
      title,
      stepsToReproduce: [
        `Open ${input.pageRoute}`,
        `Replay ${input.target.method} ${input.target.route} with the active session`,
      ],
      expected: `The endpoint should respond with one of [${expectedStatuses}] and match the normalized schema.`,
      actual: `Authenticated probe returned ${input.response.status} with body ${describeBody(input.response.body)}${schemaNote}`,
      evidenceIds: [evidenceId],
      verdict: {
        hypothesis: `${input.target.method} ${input.target.route} should satisfy the contract selected for this page.`,
        observation: `A direct replay produced a status or body outside the expected contract.`,
        evidenceChain: [
          `page:${input.pageRoute}`,
          `endpoint:${input.target.method} ${input.target.route}`,
          `status:${input.response.status}`,
          ...validation.errors.map((error) => `validation:${error}`),
        ],
        alternativesConsidered: [
          "The observed page flow may intentionally hit a different backend variant than the normalized contract expects.",
        ],
        suggestedVerification: [
          `Compare the live response for ${input.target.method} ${input.target.route} against the normalized spec.`,
        ],
      },
      meta: buildConfirmedFindingMeta({
        route: input.pageRoute,
        objective: `Replay API contract checks related to ${input.areaName}`,
        confidence: input.response.status >= 500 || validation.errors.length > 0 ? "high" : "medium",
        breadcrumbs: [`api replay ${input.target.method} ${input.target.route}`],
        evidenceIds: [evidenceId],
      }),
    },
  };
}
