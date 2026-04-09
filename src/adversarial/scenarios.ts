// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Alex Rambasek

import type { AdversarialConfig } from '../config.js';
import { listClickPathScenarios } from './click-path.js';
import { listConcurrencyScenarios } from './concurrency.js';
import { listSecurityScenarios } from './security.js';
import { listStatefulScenarios, type AdversarialScenario } from './stateful.js';

const SCENARIO_PRIORITY: Record<string, number> = {
  'authz-route-swap': 0,
  'parallel-submit-race': 1,
  'double-submit': 2,
  'back-button-resubmission': 3,
  'stale-detail-view': 4,
  'back-button-state-mismatch': 5,
  // Click-path audit patterns
  'sequential-undo': 6,
  'async-race-condition': 7,
  'stale-closure-handler': 8,
  'missing-state-transition': 9,
  'conditional-dead-path': 10,
  'effect-interference': 11,
  // OWASP-informed security patterns
  'csrf-token-absence': 12,
  'xss-input-reflection': 13,
  'missing-rate-limit': 14,
  'open-redirect': 15,
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
    ...listClickPathScenarios({ destructiveActionsAllowed }),
    ...listSecurityScenarios({ destructiveActionsAllowed }),
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
