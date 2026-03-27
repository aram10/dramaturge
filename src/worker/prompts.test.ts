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
        stableSelectors: ['#manage-kb-new-btn', '[data-testid="app-nav"]'],
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
  });
});
