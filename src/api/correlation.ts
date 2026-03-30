import type { ObservedApiEndpoint } from "../network/traffic-observer.js";
import { type ContractIndex } from "../spec/contract-index.js";
import type { ApiProbeTarget } from "./types.js";

interface SelectApiProbeTargetsInput {
  pageRoute: string;
  observedEndpoints: ObservedApiEndpoint[];
  contractIndex?: ContractIndex;
  maxEndpoints: number;
}

interface RankedProbeTarget extends ApiProbeTarget {
  score: number;
}

function normalizeRoutePath(route: string): string {
  try {
    return new URL(route).pathname;
  } catch {
    return route;
  }
}

function tokenizeRoute(route: string): string[] {
  return normalizeRoutePath(route)
    .split("/")
    .filter(Boolean)
    .map((segment) => segment.toLowerCase())
    .filter(
      (segment) =>
        segment !== "api" &&
        !/^\d+$/.test(segment) &&
        !segment.startsWith("[") &&
        !segment.startsWith("{") &&
        !segment.startsWith(":")
    );
}

function computeRouteScore(pageTokens: string[], route: string, observedBoost: number): number {
  const routeTokens = tokenizeRoute(route);
  const overlap = routeTokens.filter((token) => pageTokens.includes(token)).length;
  const prefixBoost =
    pageTokens.length > 0 && normalizeRoutePath(route).includes(pageTokens[0] ?? "")
      ? 0.25
      : 0;

  return overlap + observedBoost + prefixBoost;
}

export function selectApiProbeTargets(
  input: SelectApiProbeTargetsInput
): ApiProbeTarget[] {
  const pageTokens = tokenizeRoute(input.pageRoute);
  const ranked = new Map<string, RankedProbeTarget>();

  const upsert = (candidate: RankedProbeTarget) => {
    const key = `${candidate.method} ${candidate.route}`;
    const existing = ranked.get(key);
    if (!existing || candidate.score > existing.score) {
      ranked.set(key, candidate);
      return;
    }

    existing.authRequired = existing.authRequired || candidate.authRequired;
    existing.observedStatuses = [
      ...new Set([...existing.observedStatuses, ...candidate.observedStatuses]),
    ].sort((left, right) => left - right);
    existing.source = existing.source === "observed" ? "observed" : candidate.source;
    existing.operation = existing.operation ?? candidate.operation;
  };

  for (const endpoint of input.observedEndpoints) {
    for (const method of endpoint.methods) {
      const sample = endpoint.samples?.find(
        (candidate) => candidate.method.toUpperCase() === method.toUpperCase()
      );
      const observedStatuses =
        endpoint.samples && endpoint.samples.length > 0
          ? [
              ...new Set(
                endpoint.samples
                  .filter((candidate) => candidate.method.toUpperCase() === method.toUpperCase())
                  .map((candidate) => candidate.status)
              ),
            ].sort((left, right) => left - right)
          : endpoint.statuses;
      upsert({
        route: endpoint.route,
        method,
        authRequired: false,
        observedStatuses,
        source: "observed",
        sample,
        score: computeRouteScore(pageTokens, endpoint.route, 1),
      });
    }
  }

  for (const operation of input.contractIndex?.operations ?? []) {
    const routeScore = computeRouteScore(pageTokens, operation.route, 0);
    if (routeScore <= 0 && input.observedEndpoints.length > 0) {
      continue;
    }

    upsert({
      route: operation.route,
      method: operation.method,
      authRequired: operation.authRequired === true,
      operation,
      observedStatuses: [],
      source: "contract",
      score: routeScore + (operation.authRequired ? 0.1 : 0),
    });
  }

  return [...ranked.values()]
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      if (left.source !== right.source) {
        return left.source === "observed" ? -1 : 1;
      }

      return `${left.method} ${left.route}`.localeCompare(`${right.method} ${right.route}`);
    })
    .slice(0, input.maxEndpoints)
    .map(({ score: _score, ...target }) => target);
}
