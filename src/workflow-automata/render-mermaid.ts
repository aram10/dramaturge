// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Alex Rambasek

import { TRUNCATE_MERMAID_LABEL } from '../constants.js';
import type { WorkflowAutomaton } from './types.js';

function escapeMermaid(value: string): string {
  return value.slice(0, TRUNCATE_MERMAID_LABEL).replace(/"/g, '#quot;').replace(/\n/g, ' ');
}

export function renderWorkflowAutomatonMermaid(automaton: WorkflowAutomaton): string {
  const lines = ['graph TD'];
  for (const state of automaton.states) {
    lines.push(`  ${state.id}["${escapeMermaid(`${state.kind}: ${state.label}`)}"]`);
  }
  for (const transition of automaton.transitions) {
    const label = `${transition.action.label} (${transition.outcome}, n=${transition.observationCount})`;
    lines.push(
      `  ${transition.fromStateId} -->|"${escapeMermaid(label)}"| ${transition.toStateId}`
    );
  }
  return lines.join('\n');
}
