// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Alex Rambasek

import type { AdversarialScenario } from './stateful.js';

/**
 * Click-path audit scenarios inspired by ECC's click-path-audit skill.
 *
 * These target bugs where individual handlers work in isolation but produce
 * wrong final state when combined — the class of issue that passes unit tests
 * but fails in real user flows.
 *
 * Six bug patterns:
 * 1. Sequential Undo — later call silently resets state set by earlier call
 * 2. Async Race — final state depends on which async call resolves first
 * 3. Stale Closure — event handler captures a stale value
 * 4. Missing State Transition — handler validates/checks but never executes the action
 * 5. Conditional Dead Path — branch condition is always false at call site
 * 6. useEffect Interference — effect resets state immediately after handler sets it
 */

interface ClickPathScenarioOptions {
  destructiveActionsAllowed: boolean;
}

const CLICK_PATH_SCENARIOS: AdversarialScenario[] = [
  {
    id: 'sequential-undo',
    title: 'Sequential undo (state cancelled by side-effect)',
    description:
      'Find a multi-step interactive element (e.g. toggle then navigate, or open modal then select). ' +
      'Execute the sequence and verify the final UI state matches what the button label promises. ' +
      'Look for cases where a later state change silently undoes an earlier one — for example, ' +
      'opening a compose window that immediately gets closed by a navigation reset.',
  },
  {
    id: 'async-race-condition',
    title: 'Async race condition',
    description:
      'Find an action that triggers multiple async operations (e.g. search that fetches results ' +
      'while also updating filters, or save that validates and submits). Trigger the action, ' +
      'then quickly trigger a second related action before the first completes. Verify the final ' +
      'state is consistent — look for stale data, loading spinners stuck on, or results from the ' +
      'wrong request being displayed.',
  },
  {
    id: 'stale-closure-handler',
    title: 'Stale closure in event handler',
    description:
      'Find a counter, stepper, or multi-step form. Rapidly interact with it multiple times ' +
      '(e.g. click increment 3 times quickly, or step through a wizard and back). Check that ' +
      'the resulting count/state reflects all interactions — stale closures cause the handler ' +
      'to read an outdated value, so 3 clicks might only increment by 1.',
  },
  {
    id: 'missing-state-transition',
    title: 'Missing state transition (no-op button)',
    description:
      'For each primary action button (Save, Submit, Delete, Send, Create), click it with ' +
      'valid inputs and verify the expected state change actually occurs — not just that no ' +
      'error is shown. Check for buttons that validate but never call the API, or show success ' +
      'without persisting data. Refresh the page after the action to confirm persistence.',
    requiresMutation: true,
  },
  {
    id: 'conditional-dead-path',
    title: 'Conditional dead path',
    description:
      'Find action buttons that are conditionally enabled/disabled or that branch on state. ' +
      'Try to trigger them in edge-case states: empty form, zero items, first-time user state, ' +
      'or after clearing all data. Look for buttons that appear enabled but silently do nothing ' +
      'because an internal condition prevents execution while the UI suggests the action is available.',
  },
  {
    id: 'effect-interference',
    title: 'Effect/watcher interference',
    description:
      'Toggle a setting or state value, then immediately check if it persists. Look for cases ' +
      'where the UI briefly shows the new value then reverts — this indicates a reactive effect ' +
      '(useEffect, watcher, computed) is resetting the state. Pay attention to toggles, theme ' +
      "switches, sort order selectors, and filter controls that seem to 'snap back' after clicking.",
  },
];

export function listClickPathScenarios(options: ClickPathScenarioOptions): AdversarialScenario[] {
  return CLICK_PATH_SCENARIOS.filter(
    (scenario) => options.destructiveActionsAllowed || !scenario.requiresMutation
  );
}
