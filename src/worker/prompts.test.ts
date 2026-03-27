import { describe, it, expect } from "vitest";
import { buildWorkerSystemPrompt } from "./prompts.js";

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
  });

  it("includes observed API traffic when provided", () => {
    const prompt = buildWorkerSystemPrompt(
      "A todo app",
      "Main",
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

  it("adds stronger safety guidance when destructive actions are disabled", () => {
    const prompt = buildWorkerSystemPrompt(
      "A todo app",
      "Main",
      undefined,
      "list",
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
});
