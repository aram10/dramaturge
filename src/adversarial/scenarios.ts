import type { AdversarialConfig } from "../config.js";
import { listConcurrencyScenarios } from "./concurrency.js";
import {
  listStatefulScenarios,
  type AdversarialScenario,
} from "./stateful.js";

const SCENARIO_PRIORITY: Record<string, number> = {
  "authz-route-swap": 0,
  "parallel-submit-race": 1,
  "double-submit": 2,
  "back-button-resubmission": 3,
  "stale-detail-view": 4,
  "back-button-state-mismatch": 5,
};

export function listAdversarialScenarios(
  config: AdversarialConfig,
  destructiveActionsAllowed: boolean
): AdversarialScenario[] {
  if (!config.enabled) {
    return [];
  }

  return [
    ...listStatefulScenarios({
      destructiveActionsAllowed,
      includeAuthzProbes: config.includeAuthzProbes,
    }),
    ...listConcurrencyScenarios({
      destructiveActionsAllowed,
      includeConcurrencyProbes: config.includeConcurrencyProbes,
    }),
  ]
    .sort(
      (left, right) =>
        (SCENARIO_PRIORITY[left.id] ?? Number.MAX_SAFE_INTEGER) -
        (SCENARIO_PRIORITY[right.id] ?? Number.MAX_SAFE_INTEGER)
    )
    .slice(0, config.maxSequencesPerNode);
}

export function summarizeAdversarialScenarios(
  config: AdversarialConfig,
  destructiveActionsAllowed: boolean
): string[] {
  return listAdversarialScenarios(config, destructiveActionsAllowed).map(
    (scenario) => `${scenario.id}: ${scenario.description}`
  );
}
