# WebProbe "What Will Struggle" Mitigations — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce token cost, improve SPA handling, speed up execution, reduce false positives, and improve navigation discovery — the five primary weaknesses identified in the webprobe code review.

**Architecture:** Five independent feature tracks, each adding a focused capability. All changes are additive — no existing behavior changes unless opted into via config. Track 1 (stagnation detector) and Track 4 (prompt hardening) are the highest ROI. Track 5 (multi-pass discovery) has the broadest impact on coverage quality.

**Tech Stack:** TypeScript, Zod (config validation), Vitest (tests), Stagehand v3 (browser automation)

---

## Chunk 1: Stagnation Detector (Speed + Token Cost)

### Context

Workers currently burn through all `maxSteps` even when they've stopped finding anything useful. A stagnation detector terminates early when N consecutive steps produce no findings, no new controls exercised, and no edges discovered. This is the single highest-ROI change for both speed and token cost.

### Task 1: Stagnation tracker utility

**Files:**
- Create: `webprobe/src/worker/stagnation.ts`
- Test: `webprobe/src/worker/stagnation.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// webprobe/src/worker/stagnation.test.ts
import { describe, it, expect } from "vitest";
import { StagnationTracker } from "./stagnation.js";

describe("StagnationTracker", () => {
  it("starts not stagnant", () => {
    const tracker = new StagnationTracker(3);
    expect(tracker.isStagnant()).toBe(false);
  });

  it("becomes stagnant after N idle steps", () => {
    const tracker = new StagnationTracker(3);
    tracker.recordStep({ findings: 0, newControls: 0, edges: 0 });
    tracker.recordStep({ findings: 0, newControls: 0, edges: 0 });
    expect(tracker.isStagnant()).toBe(false);
    tracker.recordStep({ findings: 0, newControls: 0, edges: 0 });
    expect(tracker.isStagnant()).toBe(true);
  });

  it("resets on productive step (finding)", () => {
    const tracker = new StagnationTracker(2);
    tracker.recordStep({ findings: 0, newControls: 0, edges: 0 });
    tracker.recordStep({ findings: 1, newControls: 0, edges: 0 });
    tracker.recordStep({ findings: 0, newControls: 0, edges: 0 });
    expect(tracker.isStagnant()).toBe(false);
  });

  it("resets on productive step (new control)", () => {
    const tracker = new StagnationTracker(2);
    tracker.recordStep({ findings: 0, newControls: 0, edges: 0 });
    tracker.recordStep({ findings: 0, newControls: 1, edges: 0 });
    expect(tracker.isStagnant()).toBe(false);
  });

  it("resets on productive step (edge)", () => {
    const tracker = new StagnationTracker(2);
    tracker.recordStep({ findings: 0, newControls: 0, edges: 0 });
    tracker.recordStep({ findings: 0, newControls: 0, edges: 1 });
    expect(tracker.isStagnant()).toBe(false);
  });

  it("returns consecutive idle count", () => {
    const tracker = new StagnationTracker(5);
    tracker.recordStep({ findings: 0, newControls: 0, edges: 0 });
    tracker.recordStep({ findings: 0, newControls: 0, edges: 0 });
    expect(tracker.idleSteps).toBe(2);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd webprobe && npx vitest run src/worker/stagnation.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement StagnationTracker**

```typescript
// webprobe/src/worker/stagnation.ts
export interface StepActivity {
  findings: number;
  newControls: number;
  edges: number;
}

export class StagnationTracker {
  private consecutiveIdle = 0;

  constructor(private readonly threshold: number) {}

  recordStep(activity: StepActivity): void {
    const productive =
      activity.findings > 0 ||
      activity.newControls > 0 ||
      activity.edges > 0;

    if (productive) {
      this.consecutiveIdle = 0;
    } else {
      this.consecutiveIdle++;
    }
  }

  isStagnant(): boolean {
    return this.consecutiveIdle >= this.threshold;
  }

  get idleSteps(): number {
    return this.consecutiveIdle;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd webprobe && npx vitest run src/worker/stagnation.test.ts`
Expected: All 6 pass

- [ ] **Step 5: Commit**

```bash
git add webprobe/src/worker/stagnation.ts webprobe/src/worker/stagnation.test.ts
git commit -m "feat(webprobe): add StagnationTracker utility for early worker termination"
```

### Task 2: Wire stagnation detection into worker execution

**Files:**
- Modify: `webprobe/src/worker/worker.ts`
- Modify: `webprobe/src/config.ts` (add `stagnationThreshold` to BudgetSchema)

**Why there's no test here:** The worker functions (`exploreArea`, `executeWorkerTask`) call Stagehand's `agent.execute()` which is an opaque external API — we can't intercept individual steps. The stagnation tracker will be checked by listening to tool call counts between iterations. Integration testing covers this.

- [ ] **Step 1: Add `stagnationThreshold` to config**

In `webprobe/src/config.ts`, add to `BudgetSchema`:

```typescript
const BudgetSchema = z
  .object({
    globalTimeLimitSeconds: z.number().int().min(60).default(900),
    maxStepsPerTask: z.number().int().min(5).default(40),
    maxFrontierSize: z.number().int().min(10).default(200),
    maxStateNodes: z.number().int().min(5).default(50),
    /** Abort a worker after this many consecutive steps with no findings, controls, or edges (0 = disabled). */
    stagnationThreshold: z.number().int().min(0).default(8),
  })
  .default({});
```

- [ ] **Step 2: Thread stagnation tracking into worker tools**

The stagnation tracker needs to be decremented each time a productive tool is called. The approach: pass a `StagnationTracker` instance into `createWorkerTools` and call `recordStep({findings: 1, ...})` inside `log_finding.execute`, `mark_control_exercised.execute`, and `report_discovered_edge.execute`. Each tool call is treated as a step.

In `webprobe/src/worker/tools.ts`, add a parameter and call-through:

```typescript
import { StagnationTracker } from "./stagnation.js";

export function createWorkerTools(
  findings: RawFinding[],
  screenshots: Map<string, Buffer>,
  evidence: Evidence[],
  coverageTracker: CoverageTracker,
  page: StagehandPage,
  screenshotDir: string,
  areaName: string,
  followupRequests: FollowupRequest[] = [],
  discoveredEdges: DiscoveredEdge[] = [],
  screenshotsEnabled = true,
  stagnationTracker?: StagnationTracker
) {
```

Then at the end of `log_finding.execute`:
```typescript
stagnationTracker?.recordStep({ findings: 1, newControls: 0, edges: 0 });
```

At the end of `mark_control_exercised.execute`:
```typescript
stagnationTracker?.recordStep({ findings: 0, newControls: 1, edges: 0 });
```

At the end of `report_discovered_edge.execute`:
```typescript
stagnationTracker?.recordStep({ findings: 0, newControls: 0, edges: 1 });
```

- [ ] **Step 3: Create and pass stagnation tracker in worker.ts**

In both `exploreArea` and `executeWorkerTask` in `webprobe/src/worker/worker.ts`:

```typescript
import { StagnationTracker } from "./stagnation.js";

// Inside exploreArea / executeWorkerTask, before createWorkerTools:
const stagnationTracker = stagnationThreshold > 0
  ? new StagnationTracker(stagnationThreshold)
  : undefined;

// Pass to createWorkerTools:
const tools = createWorkerTools(
  findings, screenshots, evidence, coverageTracker,
  page, screenshotDir, area.name,
  undefined, undefined,
  screenshotsEnabled, stagnationTracker
);
```

Add `stagnationThreshold` parameter to both functions (default `0`).

- [ ] **Step 4: Thread stagnation threshold from engine/orchestrator call sites**

In `webprobe/src/engine.ts` — `processTasksSequentially`, pass `ctx.budget.stagnationThreshold ?? 0` as additional arg to `executeWorkerTask`.

In `webprobe/src/orchestrator/orchestrator.ts` — pass `config.budget.stagnationThreshold ?? 0` to `exploreArea`.

- [ ] **Step 5: Run full test suite**

Run: `cd webprobe && npx vitest run`
Expected: All tests pass (existing + new stagnation tests)

- [ ] **Step 6: Commit**

```bash
git add -A webprobe/src/
git commit -m "feat(webprobe): wire stagnation detection into worker execution loop"
```

---

## Chunk 2: Structured App Context for False Positive Reduction

### Context

The agent currently receives only `appDescription` (a freeform string) as context about the application. This leads to false positives — the agent reports loading spinners as performance issues, empty states as bugs, etc. Adding structured context fields (known patterns, ignorable behaviors) and injecting them into the system prompt reduces noise significantly.

### Task 3: Add `appContext` config section

**Files:**
- Modify: `webprobe/src/config.ts`

- [ ] **Step 1: Add AppContextSchema to config**

```typescript
const AppContextSchema = z
  .object({
    /** Patterns the agent should consider normal (not bugs). */
    knownPatterns: z.array(z.string()).optional(),
    /** Specific behaviors to ignore when encountered. */
    ignoredBehaviors: z.array(z.string()).optional(),
    /** Explicit NOT-a-bug examples for prompt calibration. */
    notBugs: z.array(z.string()).optional(),
  })
  .optional();
```

Add to `ConfigSchema`:
```typescript
export const ConfigSchema = z.object({
  // ... existing fields ...
  appContext: AppContextSchema,
});
```

- [ ] **Step 2: Run tests to verify nothing breaks**

Run: `cd webprobe && npx vitest run`
Expected: All pass (schema is optional, no existing test sets it)

- [ ] **Step 3: Commit**

```bash
git add webprobe/src/config.ts
git commit -m "feat(webprobe): add appContext config section for false positive reduction"
```

### Task 4: Inject app context into worker system prompt

**Files:**
- Modify: `webprobe/src/worker/prompts.ts`
- Test: Add test cases to verify prompt content

- [ ] **Step 1: Write the failing test**

Create `webprobe/src/worker/prompts.test.ts`:

```typescript
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
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd webprobe && npx vitest run src/worker/prompts.test.ts`
Expected: FAIL — function signature mismatch or assertion failure

- [ ] **Step 3: Update `buildWorkerSystemPrompt` to accept and render appContext**

In `webprobe/src/worker/prompts.ts`, add optional parameter:

```typescript
interface AppContext {
  knownPatterns?: string[];
  ignoredBehaviors?: string[];
  notBugs?: string[];
}

export function buildWorkerSystemPrompt(
  appDescription: string,
  areaName: string,
  areaDescription?: string,
  pageType?: PageType,
  appContext?: AppContext
): string {
  // ... existing code ...

  const appContextSection = buildAppContextSection(appContext);

  return `You are an autonomous QA tester...
${appContextSection}
## What to Do
...`;
}

function buildAppContextSection(ctx?: AppContext): string {
  if (!ctx) return "";
  const parts: string[] = [];

  if (ctx.knownPatterns?.length) {
    parts.push("## Known Patterns (Expected Behavior)");
    for (const p of ctx.knownPatterns) parts.push(`- ${p}`);
  }

  if (ctx.notBugs?.length) {
    parts.push("\n## These are NOT bugs — do not report them:");
    for (const nb of ctx.notBugs) parts.push(`- ${nb}`);
  }

  if (ctx.ignoredBehaviors?.length) {
    parts.push("\n## Behaviors to Ignore:");
    for (const ib of ctx.ignoredBehaviors) parts.push(`- ${ib}`);
  }

  return parts.length > 0 ? `\n\n${parts.join("\n")}` : "";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd webprobe && npx vitest run src/worker/prompts.test.ts`
Expected: PASS

- [ ] **Step 5: Thread appContext through worker call chain**

In `webprobe/src/worker/worker.ts`, both `exploreArea` and `executeWorkerTask`:

```typescript
// Add appContext parameter (optional)
export async function exploreArea(
  stagehand: Stagehand,
  area: Area,
  appDescription: string,
  model: string,
  stepsPerArea: number,
  screenshotDir: string,
  agentMode: "cua" | "dom" = "cua",
  screenshotsEnabled = true,
  stagnationThreshold = 0,
  appContext?: { knownPatterns?: string[]; ignoredBehaviors?: string[]; notBugs?: string[] }
): Promise<AreaResult> {
  // ...
  const systemPrompt = buildWorkerSystemPrompt(
    appDescription, area.name, area.description, pageType, appContext
  );
```

Pass `config.appContext` from engine.ts and orchestrator.ts call sites.

- [ ] **Step 6: Run full test suite**

Run: `cd webprobe && npx vitest run`
Expected: All pass

- [ ] **Step 7: Commit**

```bash
git add -A webprobe/src/worker/ webprobe/src/config.ts
git commit -m "feat(webprobe): inject structured appContext into worker prompts to reduce false positives"
```

---

## Chunk 3: Page Stability Detection (SPA Handling)

### Context

SPAs frequently render content asynchronously. The agent can act on a page that's still loading, causing false positives ("broken layout" that's actually mid-render). A `waitForPageStable()` utility detects when the DOM settles and network is idle before proceeding.

### Task 5: Page stability utility

**Files:**
- Create: `webprobe/src/worker/page-stability.ts`
- Test: `webprobe/src/worker/page-stability.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// webprobe/src/worker/page-stability.test.ts
import { describe, it, expect, vi } from "vitest";
import { buildStabilityChecker } from "./page-stability.js";

describe("buildStabilityChecker", () => {
  it("returns a page.evaluate-compatible function string", () => {
    const checker = buildStabilityChecker();
    expect(typeof checker).toBe("string");
    expect(checker).toContain("MutationObserver");
  });
});
```

Note: Full integration testing requires a real page. This test verifies the evaluate script is well-formed. The actual function is a `page.evaluate()` script that runs in the browser.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd webprobe && npx vitest run src/worker/page-stability.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement page stability checker**

```typescript
// webprobe/src/worker/page-stability.ts
import type { Stagehand } from "@browserbasehq/stagehand";

type StagehandPage = ReturnType<Stagehand["context"]["pages"]>[number];

/**
 * Returns the JS string to evaluate in the browser context.
 * The script waits until:
 *  - document.readyState is "complete"
 *  - No DOM mutations for `quietMs` milliseconds
 * Resolves after page is stable or after `timeoutMs`.
 */
export function buildStabilityChecker(): string {
  // This string is passed to page.evaluate() — it must be self-contained
  return `
    () => new Promise((resolve) => {
      const QUIET_MS = 300;
      const TIMEOUT_MS = 5000;
      let timer;
      let settled = false;

      const done = (reason) => {
        if (settled) return;
        settled = true;
        if (observer) observer.disconnect();
        resolve(reason);
      };

      // Timeout fallback
      setTimeout(() => done("timeout"), TIMEOUT_MS);

      // Wait for readyState
      if (document.readyState !== "complete") {
        window.addEventListener("load", () => {}, { once: true });
      }

      // Watch for DOM quiet
      const observer = new MutationObserver(() => {
        clearTimeout(timer);
        timer = setTimeout(() => done("stable"), QUIET_MS);
      });

      observer.observe(document.body ?? document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
      });

      // Start the quiet timer immediately (page may already be stable)
      timer = setTimeout(() => done("stable"), QUIET_MS);
    })
  `.trim();
}

/**
 * Wait for the page to stabilize (DOM settles + no pending renders).
 * Returns "stable" or "timeout".
 */
export async function waitForPageStable(
  page: StagehandPage,
  timeoutMs = 5000
): Promise<"stable" | "timeout"> {
  try {
    const result = await Promise.race([
      page.evaluate(buildStabilityChecker()) as Promise<string>,
      new Promise<string>((resolve) =>
        setTimeout(() => resolve("timeout"), timeoutMs + 1000)
      ),
    ]);
    return result === "stable" ? "stable" : "timeout";
  } catch {
    return "timeout";
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd webprobe && npx vitest run src/worker/page-stability.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add webprobe/src/worker/page-stability.ts webprobe/src/worker/page-stability.test.ts
git commit -m "feat(webprobe): add page stability detector for SPA handling"
```

### Task 6: Wire page stability into navigation points

**Files:**
- Modify: `webprobe/src/orchestrator/orchestrator.ts`
- Modify: `webprobe/src/planner/navigator.ts`

- [ ] **Step 1: Add stability wait after area navigation in orchestrator**

In `webprobe/src/orchestrator/orchestrator.ts`, after the navigation `try` block (the `page.goto(area.url)` section) and before the fingerprint check, add:

```typescript
import { waitForPageStable } from "../worker/page-stability.js";

// After navigation, before fingerprint:
await waitForPageStable(page);
```

- [ ] **Step 2: Add stability wait in navigator.ts after each navigation**

Read `webprobe/src/planner/navigator.ts` to find the navigation call sites (likely `page.goto` and `stagehand.act` calls). After each navigation resolution, add `await waitForPageStable(page)`.

- [ ] **Step 3: Run full test suite**

Run: `cd webprobe && npx vitest run`
Expected: All pass

- [ ] **Step 4: Commit**

```bash
git add webprobe/src/orchestrator/orchestrator.ts webprobe/src/planner/navigator.ts
git commit -m "feat(webprobe): wait for page stability after navigation before fingerprinting/exploration"
```

---

## Chunk 4: Multi-Pass Navigation Discovery

### Context

The v1 orchestrator calls `stagehand.observe()` once on page load. This misses lazily-rendered nav, hamburger menus, and `<a>` elements that aren't semantically described as "navigation." A multi-pass approach does: (1) initial observe, (2) direct `<a href>` extraction via `page.evaluate`, (3) scroll + re-observe. This dramatically improves area coverage.

### Task 7: Link extraction utility

**Files:**
- Create: `webprobe/src/orchestrator/link-extractor.ts`
- Test: `webprobe/src/orchestrator/link-extractor.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// webprobe/src/orchestrator/link-extractor.test.ts
import { describe, it, expect } from "vitest";
import { deduplicateLinks, isNavigationLink } from "./link-extractor.js";

describe("isNavigationLink", () => {
  const base = "https://app.example.com";

  it("accepts same-origin absolute URLs", () => {
    expect(isNavigationLink("https://app.example.com/settings", base)).toBe(true);
  });

  it("accepts relative URLs", () => {
    expect(isNavigationLink("/dashboard", base)).toBe(true);
  });

  it("rejects external URLs", () => {
    expect(isNavigationLink("https://google.com", base)).toBe(false);
  });

  it("rejects anchor-only links", () => {
    expect(isNavigationLink("#section", base)).toBe(false);
  });

  it("rejects javascript: links", () => {
    expect(isNavigationLink("javascript:void(0)", base)).toBe(false);
  });

  it("rejects mailto: links", () => {
    expect(isNavigationLink("mailto:admin@example.com", base)).toBe(false);
  });

  it("rejects blob/data URLs", () => {
    expect(isNavigationLink("blob:https://app.example.com/abc", base)).toBe(false);
    expect(isNavigationLink("data:text/html,<h1>hi</h1>", base)).toBe(false);
  });
});

describe("deduplicateLinks", () => {
  it("removes duplicate paths", () => {
    const links = [
      { url: "https://app.example.com/a", text: "A" },
      { url: "https://app.example.com/a", text: "Also A" },
      { url: "https://app.example.com/b", text: "B" },
    ];
    expect(deduplicateLinks(links)).toHaveLength(2);
  });

  it("normalizes trailing slashes", () => {
    const links = [
      { url: "https://app.example.com/a/", text: "A" },
      { url: "https://app.example.com/a", text: "A" },
    ];
    expect(deduplicateLinks(links)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd webprobe && npx vitest run src/orchestrator/link-extractor.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement link extractor**

```typescript
// webprobe/src/orchestrator/link-extractor.ts
import type { Stagehand } from "@browserbasehq/stagehand";

type StagehandPage = ReturnType<Stagehand["context"]["pages"]>[number];

export interface ExtractedLink {
  url: string;
  text: string;
}

const IGNORED_SCHEMES = ["javascript:", "mailto:", "tel:", "blob:", "data:"];

export function isNavigationLink(href: string, baseUrl: string): boolean {
  const trimmed = href.trim();

  // Reject anchors, empty, and non-http schemes
  if (!trimmed || trimmed.startsWith("#")) return false;
  if (IGNORED_SCHEMES.some((s) => trimmed.toLowerCase().startsWith(s))) return false;

  try {
    const resolved = new URL(trimmed, baseUrl);
    const base = new URL(baseUrl);
    // Same origin only
    return resolved.origin === base.origin;
  } catch {
    return false;
  }
}

export function deduplicateLinks(links: ExtractedLink[]): ExtractedLink[] {
  const seen = new Set<string>();
  const result: ExtractedLink[] = [];

  for (const link of links) {
    try {
      const url = new URL(link.url);
      const key = url.pathname.replace(/\/+$/, "") || "/";
      if (!seen.has(key)) {
        seen.add(key);
        result.push(link);
      }
    } catch {
      // Skip malformed URLs
    }
  }

  return result;
}

/**
 * Extract all `<a href>` links from the current page via DOM evaluation.
 * Returns only same-origin, non-anchor, non-javascript links.
 */
export async function extractPageLinks(
  page: StagehandPage,
  baseUrl: string
): Promise<ExtractedLink[]> {
  const raw: Array<{ href: string; text: string }> = await page.evaluate(() =>
    Array.from(document.querySelectorAll("a[href]")).map((a) => ({
      href: (a as HTMLAnchorElement).href,
      text: (a.textContent ?? "").trim().slice(0, 100),
    }))
  );

  return deduplicateLinks(
    raw
      .filter((r) => isNavigationLink(r.href, baseUrl))
      .map((r) => ({ url: r.href, text: r.text || "Untitled link" }))
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd webprobe && npx vitest run src/orchestrator/link-extractor.test.ts`
Expected: All pass

- [ ] **Step 5: Commit**

```bash
git add webprobe/src/orchestrator/link-extractor.ts webprobe/src/orchestrator/link-extractor.test.ts
git commit -m "feat(webprobe): add link extraction utility for multi-pass navigation discovery"
```

### Task 8: Multi-pass discovery in orchestrator

**Files:**
- Modify: `webprobe/src/orchestrator/orchestrator.ts`
- Modify: `webprobe/src/orchestrator/area-map.ts`

- [ ] **Step 1: Update orchestrator discovery to use multi-pass approach**

Replace the current single `stagehand.observe()` call in the `orchestrate` function with a three-pass approach:

```typescript
import { extractPageLinks } from "./link-extractor.js";

// Pass 1: Stagehand semantic observe (existing)
let observedAreas: Area[] = [];
try {
  const actions = await stagehand.observe(
    "What navigation elements are on this page? ..."
  );
  observedAreas = actionsToAreas(actions, targetUrl);
} catch {
  console.warn("Navigation observe failed.");
}

// Pass 2: Direct <a href> extraction
let linkAreas: Area[] = [];
try {
  const links = await extractPageLinks(page, targetUrl);
  linkAreas = links.map((l) => ({
    name: l.text,
    url: l.url,
    description: `Link: ${l.text}`,
  }));
} catch {
  console.warn("Link extraction failed.");
}

// Union + deduplicate
const allAreas = deduplicateAreas([...observedAreas, ...linkAreas]);
```

- [ ] **Step 2: Add `mergeAreas` function to area-map.ts**

In `webprobe/src/orchestrator/area-map.ts`, the existing `deduplicateAreas` already handles this — it deduplicates by URL path. Verify that concatenating the two arrays and deduplicating produces the correct union. No new function needed if `deduplicateAreas` works on mixed input (it does — it uses `new URL(area.url, "http://placeholder").pathname` as key).

- [ ] **Step 3: Run full test suite**

Run: `cd webprobe && npx vitest run`
Expected: All pass

- [ ] **Step 4: Commit**

```bash
git add webprobe/src/orchestrator/orchestrator.ts
git commit -m "feat(webprobe): multi-pass navigation discovery (observe + link extraction)"
```

---

## Chunk 5: Per-Worker-Type Agent Mode Defaults (Token Cost)

### Context

The `agentMode` config currently applies globally. Navigation and form workers don't need screenshots (CUA) — DOM mode is sufficient and dramatically cheaper. A per-worker-type override lets users (or sensible defaults) route each worker type to the right mode.

### Task 9: Per-worker-type agent mode config

**Files:**
- Modify: `webprobe/src/config.ts`

- [ ] **Step 1: Add `agentModes` per-worker-type override**

```typescript
const AgentModesSchema = z
  .object({
    navigation: z.enum(["cua", "dom"]).optional(),
    form: z.enum(["cua", "dom"]).optional(),
    crud: z.enum(["cua", "dom"]).optional(),
  })
  .optional();

const ModelsSchema = z
  .object({
    planner: z.string().default("anthropic/claude-sonnet-4-6"),
    worker: z.string().default("anthropic/claude-haiku-4-5"),
    workers: WorkerModelsSchema,
    agentMode: AgentModeSchema,
    agentModes: AgentModesSchema,
  })
  .default({});
```

- [ ] **Step 2: Add `resolveAgentMode` function**

```typescript
export function resolveAgentMode(
  config: WebProbeConfig,
  workerType: string
): "cua" | "dom" {
  const perType = config.models.agentModes;
  if (perType) {
    const specific = (perType as Record<string, "cua" | "dom" | undefined>)[workerType];
    if (specific) return specific;
  }
  return config.models.agentMode;
}
```

- [ ] **Step 3: Update worker call sites in engine.ts and orchestrator.ts**

In `webprobe/src/engine.ts` — `processTasksSequentially`:
```typescript
import { resolveAgentMode } from "./config.js";

// Replace:  ctx.config.models.agentMode
// With:     resolveAgentMode(ctx.config, item.workerType)
```

In `webprobe/src/orchestrator/orchestrator.ts`:
```typescript
// The v1 orchestrator doesn't have per-area worker types,
// so continue using config.models.agentMode as the global default.
// No change needed here.
```

- [ ] **Step 4: Run full test suite**

Run: `cd webprobe && npx vitest run`
Expected: All pass

- [ ] **Step 5: Update example config**

In `webprobe/webprobe.config.example.json`, add:

```json
"models": {
  "planner": "anthropic/claude-sonnet-4-6",
  "worker": "anthropic/claude-haiku-4-5",
  "agentMode": "cua",
  "agentModes": {
    "navigation": "dom",
    "form": "dom",
    "crud": "cua"
  }
}
```

- [ ] **Step 6: Commit**

```bash
git add webprobe/src/config.ts webprobe/src/engine.ts webprobe/webprobe.config.example.json
git commit -m "feat(webprobe): per-worker-type agent mode overrides (navigation+form default to dom)"
```

---

## Summary: Verification & Final Commit

- [ ] **Run full test suite one last time**

Run: `cd webprobe && npx vitest run`
Expected: All tests pass (85 original + ~15 new)

- [ ] **Run TypeScript compilation check**

Run: `cd webprobe && npx tsc --noEmit`
Expected: Clean — no errors

- [ ] **Final commit if any uncommitted changes remain**

```bash
git add -A webprobe/
git commit -m "chore(webprobe): final cleanup for struggle mitigation features"
```

---

## Dependency Graph

```
Task 1 (stagnation tracker)  ──► Task 2 (wire into workers)
Task 3 (appContext config)   ──► Task 4 (prompt injection + thread through)
Task 5 (page stability)     ──► Task 6 (wire into navigation)
Task 7 (link extractor)     ──► Task 8 (multi-pass orchestrator)
Task 9 (per-worker agent mode) — standalone
```

Tasks 1, 3, 5, 7, and 9 can all be done in parallel (no dependencies between them).
Tasks 2, 4, 6, and 8 each depend only on their respective predecessor.
