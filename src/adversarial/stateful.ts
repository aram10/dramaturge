export interface AdversarialScenario {
  id: string;
  title: string;
  description: string;
  requiresMutation?: boolean;
}

interface StatefulScenarioOptions {
  destructiveActionsAllowed: boolean;
  includeAuthzProbes: boolean;
}

const BASE_STATEFUL_SCENARIOS: AdversarialScenario[] = [
  {
    id: "stale-detail-view",
    title: "Stale detail view",
    description:
      "Navigate between list and detail views, then refresh or revisit to look for stale data, mismatched breadcrumbs, or actions that still target an old record.",
  },
  {
    id: "back-button-state-mismatch",
    title: "Back-button state mismatch",
    description:
      "Use browser back/forward navigation after filtering, opening drawers, or switching tabs to catch UI state that no longer matches the visible route.",
  },
  {
    id: "double-submit",
    title: "Double submit",
    description:
      "On a low-risk form, try rapid repeat submission once to confirm the UI prevents duplicate requests and shows stable pending/success feedback.",
    requiresMutation: true,
  },
  {
    id: "back-button-resubmission",
    title: "Back-button resubmission",
    description:
      "After a low-risk form submission, use back/forward navigation to verify the browser does not silently replay the submit or surface stale success state.",
    requiresMutation: true,
  },
];

export function listStatefulScenarios(
  options: StatefulScenarioOptions
): AdversarialScenario[] {
  const scenarios = BASE_STATEFUL_SCENARIOS.filter(
    (scenario) => options.destructiveActionsAllowed || !scenario.requiresMutation
  );

  if (options.includeAuthzProbes) {
    scenarios.push({
      id: "authz-route-swap",
      title: "Authorization route swap",
      description:
        "After reaching a privileged area, try neighboring routes, deep links, or IDs that should stay forbidden and confirm the UI and backend both reject them cleanly.",
    });
  }

  return scenarios;
}
