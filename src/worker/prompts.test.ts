import { describe, it, expect } from "vitest";
import { buildWorkerSystemPrompt, buildAgentRoleSection } from "./prompts.js";

describe("buildWorkerSystemPrompt", () => {
  it("includes app context known patterns when provided", () => {
    const prompt = buildWorkerSystemPrompt(
      "A todo app",
      "Main",
      undefined,
      undefined,
      {
        knownPatterns: ["Empty list shows 'No items yet'"],
        notBugs: ["Loading spinner appears for up to 3 seconds"],
      }
    );
    expect(prompt).toContain("No items yet");
    expect(prompt).toContain("Loading spinner appears for up to 3 seconds");
    expect(prompt).toContain("NOT bugs");
  });

  it("omits app context section when not provided", () => {
    const prompt = buildWorkerSystemPrompt("A todo app", "Main");
    expect(prompt).not.toContain("Known Patterns");
    expect(prompt).not.toContain("NOT bugs");
  });

  it("includes ignored behaviors when provided", () => {
    const prompt = buildWorkerSystemPrompt(
      "A todo app",
      "Main",
      undefined,
      undefined,
      {
        ignoredBehaviors: ["Occasional 500ms delay on API calls"],
      }
    );
    expect(prompt).toContain("500ms delay on API calls");
    expect(prompt).toContain("Ignore");
  });

  it("includes compact repo hints when provided", () => {
    const prompt = buildWorkerSystemPrompt(
      "A todo app",
      "Main",
      undefined,
      undefined,
      undefined,
      {
        routes: ["/login", "/manage/knowledge-bases", "/?kb=starter"],
        routeFamilies: ["/", "/login", "/manage"],
        stableSelectors: ['#manage-kb-new-btn', '[data-testid="app-nav"]'],
        apiEndpoints: [
          {
            route: "/api/manage/knowledge-bases",
            methods: ["GET"],
            statuses: [401, 403],
            authRequired: true,
            validationSchemas: ["CreateKnowledgeBaseSchema"],
          },
        ],
        authHints: {
          loginRoutes: ["/login"],
          callbackRoutes: ["/auth/callback"],
        },
        expectedHttpNoise: [],
      }
    );

    expect(prompt).toContain("Repo Hints");
    expect(prompt).toContain("/manage/knowledge-bases");
    expect(prompt).toContain("#manage-kb-new-btn");
    expect(prompt).toContain("/login");
    expect(prompt).toContain("Route families");
    expect(prompt).toContain("/manage");
    expect(prompt).toContain("API endpoints");
    expect(prompt).toContain("GET /api/manage/knowledge-bases");
    expect(prompt).toContain("expected statuses 401, 403");
    expect(prompt).toContain("requires auth");
    expect(prompt).toContain("CreateKnowledgeBaseSchema");
  });

  it("includes observed API traffic when provided", () => {
    const prompt = buildWorkerSystemPrompt(
      "A todo app",
      "Main",
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      [
        {
          route: "/api/widgets",
          methods: ["GET", "POST"],
          statuses: [0, 200, 201],
          failures: ["net::ERR_CONNECTION_RESET"],
        },
      ]
    );

    expect(prompt).toContain("Observed API Traffic");
    expect(prompt).toContain("GET/POST /api/widgets");
    expect(prompt).toContain("0, 200, 201");
    expect(prompt).toContain("net::ERR_CONNECTION_RESET");
  });

  it("includes condensed contract summaries when provided", () => {
    const prompt = buildWorkerSystemPrompt(
      "A todo app",
      "Main",
      undefined,
      undefined,
      undefined,
      undefined,
      ["POST /api/widgets (statuses 201, 400; request body required)"],
      undefined
    );

    expect(prompt).toContain("Contract Expectations");
    expect(prompt).toContain("POST /api/widgets");
    expect(prompt).toContain("request body required");
  });

  it("adds stronger safety guidance when destructive actions are disabled", () => {
    const prompt = buildWorkerSystemPrompt(
      "A todo app",
      "Main",
      undefined,
      "list",
      undefined,
      undefined,
      undefined,
      undefined,
      {
        appDescription: "A todo app",
        destructiveActionsAllowed: false,
        criticalFlows: ["knowledge-bases", "search"],
      }
    );

    expect(prompt).toContain("Destructive actions are disabled");
    expect(prompt).toContain("knowledge-bases");
    expect(prompt).toContain("search");
  });

  it("includes historical suppressions, flaky-page notes, and prior navigation hints when provided", () => {
    const prompt = buildWorkerSystemPrompt(
      "A todo app",
      "Settings",
      undefined,
      "settings",
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        suppressedFindings: ["Known spinner jitter on autosave toast"],
        flakyPageNotes: ["Relative timestamps refresh every second near the header"],
        navigationHints: ["Known transition: Settings -> Members via role=button[name=Members]"],
        authHints: ["Successful login has historically started at /login"],
        apiHints: [
          {
            route: "/api/settings/members",
            methods: ["GET", "POST"],
            statuses: [200, 400],
            failures: ["validation failed"],
          },
        ],
      }
    );

    expect(prompt).toContain("Historical Notes");
    expect(prompt).toContain("spinner jitter");
    expect(prompt).toContain("Relative timestamps refresh every second");
    expect(prompt).toContain("Settings -> Members");
    expect(prompt).toContain("historically started at /login");
    expect(prompt).toContain("Historical API hints");
    expect(prompt).toContain("GET/POST /api/settings/members");
  });

  it("adds adversarial guardrails and scenario guidance when adversarial mode is enabled", () => {
    const prompt = buildWorkerSystemPrompt(
      "A todo app",
      "Profile settings",
      undefined,
      "settings",
      undefined,
      undefined,
      undefined,
      undefined,
      {
        appDescription: "A todo app",
        destructiveActionsAllowed: false,
      },
      undefined,
      "adversarial",
      {
        enabled: true,
        maxSequencesPerNode: 3,
        safeMode: true,
        includeAuthzProbes: false,
        includeConcurrencyProbes: false,
      }
    );

    expect(prompt).toContain("Adversarial Mode");
    expect(prompt).toContain("Safe mode is enabled");
    expect(prompt).toContain("stale-detail-view");
    expect(prompt).toContain("back-button-state-mismatch");
    expect(prompt).not.toContain("double-submit");
    expect(prompt).toContain("boundary-text");
  });

  it("includes scout agent role guidance when agentRole is scout", () => {
    const prompt = buildWorkerSystemPrompt(
      "A todo app",
      "Main",
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      "scout"
    );

    expect(prompt).toContain("Agent Role: Scout");
    expect(prompt).toContain("surface-area mapping");
    expect(prompt).toContain("breadth over depth");
  });

  it("includes tester agent role guidance when agentRole is tester", () => {
    const prompt = buildWorkerSystemPrompt(
      "A todo app",
      "Form area",
      undefined,
      "form",
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      "form",
      undefined,
      "tester"
    );

    expect(prompt).toContain("Agent Role: Tester");
    expect(prompt).toContain("deep testing");
    expect(prompt).toContain("validation rules");
  });

  it("includes security agent role guidance when agentRole is security", () => {
    const prompt = buildWorkerSystemPrompt(
      "A todo app",
      "Settings",
      undefined,
      "settings",
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      "adversarial",
      undefined,
      "security"
    );

    expect(prompt).toContain("Agent Role: Security");
    expect(prompt).toContain("OWASP");
    expect(prompt).toContain("adversarial testing");
  });

  it("includes reviewer agent role guidance", () => {
    const prompt = buildWorkerSystemPrompt(
      "A todo app",
      "Review",
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      "reviewer"
    );

    expect(prompt).toContain("Agent Role: Reviewer");
    expect(prompt).toContain("quality oversight");
  });

  it("includes reporter agent role guidance", () => {
    const prompt = buildWorkerSystemPrompt(
      "A todo app",
      "Report",
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      "reporter"
    );

    expect(prompt).toContain("Agent Role: Reporter");
    expect(prompt).toContain("synthesis");
  });

  it("includes blackboard summary when provided with agent role", () => {
    const prompt = buildWorkerSystemPrompt(
      "A todo app",
      "Main",
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      "scout",
      "Blackboard (2 entries, showing last 2):\n[finding] (agent-tester) Missing label\n[coverage] (agent-scout) 5 pages mapped"
    );

    expect(prompt).toContain("Team Blackboard");
    expect(prompt).toContain("Missing label");
    expect(prompt).toContain("5 pages mapped");
  });

  it("omits agent role section when not provided", () => {
    const prompt = buildWorkerSystemPrompt("A todo app", "Main");
    expect(prompt).not.toContain("Agent Role");
    expect(prompt).not.toContain("Team Blackboard");
  });
});

describe("buildAgentRoleSection", () => {
  it("returns empty string when no role provided", () => {
    expect(buildAgentRoleSection()).toBe("");
    expect(buildAgentRoleSection(undefined)).toBe("");
  });

  it("returns role section without blackboard when summary not provided", () => {
    const section = buildAgentRoleSection("scout");
    expect(section).toContain("Agent Role: Scout");
    expect(section).not.toContain("Team Blackboard");
  });

  it("includes blackboard section when summary is provided", () => {
    const section = buildAgentRoleSection("tester", "Some board summary");
    expect(section).toContain("Agent Role: Tester");
    expect(section).toContain("Team Blackboard");
    expect(section).toContain("Some board summary");
  });
});
