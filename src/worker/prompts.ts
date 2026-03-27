import type { MissionConfig, PageType } from "../types.js";
import type { RepoHints } from "../adaptation/types.js";
import type { WorkerHistoryContext } from "../memory/types.js";
import type { ObservedApiEndpoint } from "../network/traffic-observer.js";

interface AppContext {
  knownPatterns?: string[];
  ignoredBehaviors?: string[];
  notBugs?: string[];
}

function buildAppContextSection(ctx?: AppContext): string {
  if (!ctx) return "";
  const parts: string[] = [];

  if (ctx.knownPatterns?.length) {
    parts.push("## Known Patterns (Expected Behavior)");
    for (const p of ctx.knownPatterns) parts.push(`- ${p}`);
  }

  if (ctx.notBugs?.length) {
    parts.push("\n## These are NOT bugs \u2014 do not report them:");
    for (const nb of ctx.notBugs) parts.push(`- ${nb}`);
  }

  if (ctx.ignoredBehaviors?.length) {
    parts.push("\n## Behaviors to Ignore:");
    for (const ib of ctx.ignoredBehaviors) parts.push(`- ${ib}`);
  }

  return parts.length > 0 ? `\n\n${parts.join("\n")}` : "";
}

function buildRepoHintsSection(repoHints?: RepoHints): string {
  if (!repoHints) return "";

  const parts: string[] = [];

  if (repoHints.routes.length > 0) {
    parts.push("## Repo Hints");
    parts.push(
      `Known route families: ${repoHints.routes.slice(0, 6).join(", ")}`
    );
  }

  if ((repoHints.routeFamilies?.length ?? 0) > 0) {
    if (parts.length === 0) parts.push("## Repo Hints");
    parts.push(`Route families: ${repoHints.routeFamilies.slice(0, 6).join(", ")}`);
  }

  if (repoHints.stableSelectors.length > 0) {
    parts.push(
      `Stable selectors: ${repoHints.stableSelectors.slice(0, 6).join(", ")}`
    );
  }

  if ((repoHints.apiEndpoints?.length ?? 0) > 0) {
    if (parts.length === 0) parts.push("## Repo Hints");
    parts.push(
      `API endpoints: ${repoHints.apiEndpoints
        .slice(0, 4)
        .map((endpoint) => `${endpoint.methods.join("/") || "ANY"} ${endpoint.route}`)
        .join(", ")}`
    );
  }

  if (repoHints.authHints.loginRoutes.length > 0) {
    parts.push(
      `Login routes: ${repoHints.authHints.loginRoutes.slice(0, 3).join(", ")}`
    );
  }

  if (repoHints.authHints.callbackRoutes.length > 0) {
    parts.push(
      `Callback routes: ${repoHints.authHints.callbackRoutes.slice(0, 3).join(", ")}`
    );
  }

  return parts.length > 0 ? `\n\n${parts.join("\n")}` : "";
}

function buildMissionSection(mission?: MissionConfig): string {
  if (!mission) return "";

  const parts: string[] = [];

  if (mission.criticalFlows?.length) {
    parts.push("## Critical Flows");
    for (const flow of mission.criticalFlows) {
      parts.push(`- Prioritize: ${flow}`);
    }
  }

  if (!mission.destructiveActionsAllowed) {
    parts.push("## Safety Guardrail");
    parts.push(
      "Destructive actions are disabled for this run. Do not delete records, clear lists, or trigger irreversible changes."
    );
  }

  return parts.length > 0 ? `\n\n${parts.join("\n")}` : "";
}

function buildObservedApiSection(observedApiEndpoints?: ObservedApiEndpoint[]): string {
  if (!observedApiEndpoints?.length) return "";

  return `\n\n## Observed API Traffic\n${observedApiEndpoints
    .slice(0, 6)
    .map((endpoint) => {
      const statuses =
        endpoint.statuses.length > 0 ? `statuses=${endpoint.statuses.join(", ")}` : undefined;
      const failures =
        endpoint.failures.length > 0 ? `failures=${endpoint.failures.join(" | ")}` : undefined;
      return `- ${endpoint.methods.join("/") || "ANY"} ${endpoint.route}${
        [statuses, failures].filter(Boolean).length > 0
          ? ` (${[statuses, failures].filter(Boolean).join("; ")})`
          : ""
      }`;
    })
    .join("\n")}`;
}

function buildHistoricalContextSection(history?: WorkerHistoryContext): string {
  if (!history) return "";

  const parts: string[] = [];

  if (history.suppressedFindings.length > 0) {
    parts.push("## Historical Notes");
    parts.push(
      `Previously suppressed findings to avoid re-reporting unless the behavior materially changed: ${history.suppressedFindings.join(
        " | "
      )}`
    );
  }

  if (history.flakyPageNotes.length > 0) {
    if (parts.length === 0) parts.push("## Historical Notes");
    parts.push(`Historically dynamic page notes: ${history.flakyPageNotes.join(" | ")}`);
  }

  if (history.navigationHints.length > 0) {
    if (parts.length === 0) parts.push("## Historical Notes");
    parts.push(`Navigation hints from prior runs: ${history.navigationHints.join(" | ")}`);
  }

  if (history.authHints.length > 0) {
    if (parts.length === 0) parts.push("## Historical Notes");
    parts.push(`Authentication hints from prior runs: ${history.authHints.join(" | ")}`);
  }

  return parts.length > 0 ? `\n\n${parts.join("\n")}` : "";
}

export function buildWorkerSystemPrompt(
  appDescription: string,
  areaName: string,
  areaDescription?: string,
  pageType?: PageType,
  appContext?: AppContext,
  repoHints?: RepoHints,
  observedApiEndpoints?: ObservedApiEndpoint[],
  mission?: MissionConfig,
  history?: WorkerHistoryContext
): string {
  const areaContext = areaDescription
    ? `\n\nAbout this area: ${areaDescription}`
    : "";

  const pageTypeContext = pageType && pageType !== "unknown"
    ? `\n\n## Page Type Detected: ${pageType}\n${getPageTypeGuidance(pageType)}`
    : "";

  return `You are an autonomous QA tester exploring a web application. Your job is to find bugs, UX issues, accessibility problems, and visual glitches through hands-on exploration.

## The Application
${appDescription}${buildRepoHintsSection(repoHints)}${buildObservedApiSection(observedApiEndpoints)}

## Your Assignment
You are exploring the "${areaName}" area of the application.${areaContext}${pageTypeContext}${buildAppContextSection(appContext)}${buildMissionSection(mission)}${buildHistoricalContextSection(history)}

## What to Do
1. Systematically explore all visible UI elements in this area
2. Click buttons, open menus, expand sections, interact with controls
3. Fill out forms with realistic test data and submit them
4. Test edge cases: empty fields, very long text, special characters
5. Check that navigation within this area works correctly
6. Look for error states, broken layouts, missing content, and visual glitches
7. Verify that actions produce expected results (success messages, data updates, etc.)

## What to Report
Use the log_finding tool whenever you observe:
- **Bugs**: Features that don't work, errors on screen, crashes, data not saving
- **UX Concerns**: Confusing flows, missing feedback, unclear labels, poor error messages
- **Accessibility Issues**: Missing labels, poor contrast, keyboard navigation problems
- **Performance Issues**: Slow loading, unresponsive UI, laggy interactions
- **Visual Glitches**: Overlapping elements, cut-off text, broken layouts, misaligned items

Use the take_screenshot tool to capture visual evidence BEFORE logging a finding. Then pass the returned evidenceId into the log_finding call to link them together.

Use the mark_control_exercised tool after interacting with any control (button, input, toggle, etc.) to track testing coverage.

## Guidelines
1. **Prefer read-only exploration** — Navigate, click, observe. Only fill forms and submit when testing that flow specifically.
2. **Minimize data mutation** — If you create test data (a record, an upload), attempt to delete it when you are done testing that flow.
3. **Avoid bulk destructive actions** — Do not click "Delete All" or clear entire lists. Test single-item deletion if needed.
4. **Do not loop** — If you have tested something, move on. Do not repeatedly submit the same form or click the same button.
5. **Stay in scope** — Explore your assigned area only. Do not navigate to other sections of the application.
6. **Be thorough but efficient** — Try to cover as many interactive elements as possible within your step budget.
7. **Link evidence** — Always take a screenshot before logging a finding, and include the evidenceId in the finding.
8. **Track coverage** — Call mark_control_exercised after each meaningful interaction.`;
}

function getPageTypeGuidance(pageType: PageType): string {
  switch (pageType) {
    case "form":
      return `This page contains form inputs. Focus on:
- Required field validation (submit with empty required fields)
- Input boundary testing (very long strings, special characters, SQL-like input)
- Cancel/reset behavior
- Save success and failure feedback
- Dirty-form warnings when navigating away`;

    case "list":
      return `This page contains a list or table. Focus on:
- Filter and search functionality
- Sort behavior on column headers
- Pagination (if any)
- Row actions (edit, delete, view)
- Empty state when filters match nothing
- Bulk selection behavior (if present)`;

    case "detail":
      return `This is a detail/view page. Focus on:
- Data display correctness
- Edit/delete actions
- Navigation back to list
- Related data sections
- Action button behavior`;

    case "dashboard":
      return `This is a dashboard page. Focus on:
- Widget loading and display
- Data freshness indicators
- Click-through links to detail views
- Empty/error states for individual widgets
- Layout and responsive behavior`;

    case "settings":
      return `This is a settings page. Focus on:
- Save/apply behavior
- Reset to defaults
- Validation of setting values
- Immediate vs. deferred settings
- Confirmation dialogs for destructive changes`;

    case "wizard":
      return `This is a multi-step wizard. Focus on:
- Step progression (next/back)
- Validation at each step before proceeding
- Data preservation when going back
- Skip/cancel behavior
- Final confirmation step`;

    case "modal":
      return `A modal dialog is open. Focus on:
- Close behavior (X button, Escape key, backdrop click)
- Focus trapping within the modal
- Form submission within the modal
- Scroll behavior for long content
- Stacking behavior if another modal opens`;

    case "auth":
      return `This is an authentication page. Focus on:
- Form validation (empty fields, invalid formats)
- Error messages for bad credentials
- Password visibility toggle
- Remember me / stay signed in options`;

    case "landing":
      return `This is a landing/home page. Focus on:
- Navigation links working correctly
- Hero section display
- Call-to-action buttons
- Content loading`;

    default:
      return "";
  }
}
