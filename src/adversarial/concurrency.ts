import type { AdversarialScenario } from './stateful.js';

interface ConcurrencyScenarioOptions {
  destructiveActionsAllowed: boolean;
  includeConcurrencyProbes: boolean;
}

export function listConcurrencyScenarios(
  options: ConcurrencyScenarioOptions
): AdversarialScenario[] {
  if (!options.includeConcurrencyProbes || !options.destructiveActionsAllowed) {
    return [];
  }

  return [
    {
      id: 'parallel-submit-race',
      title: 'Parallel submit race',
      description:
        'In a low-risk workflow, trigger two near-simultaneous submissions or saves to check idempotency, pending-state locking, and duplicate-record prevention.',
      requiresMutation: true,
    },
  ];
}
