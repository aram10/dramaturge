# Dramaturge Review-Driven Hardening Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden Dramaturge around resume correctness, API replay reliability, operational visibility, and public maintainability based on the attached review feedback, while avoiding churn on suggestions that are only partially correct.

**Architecture:** Treat the review as a triage input, not a blindly accepted spec. The work should land as a small stack of focused PRs that first fix correctness and observability, then improve operational discipline, and finally reduce maintenance risk around typing and IO boundaries. Wherever a suggestion is directionally right but technically imprecise, implement the underlying fix rather than the literal recommendation.

**Tech Stack:** TypeScript, Vitest, Playwright, Stagehand, GitHub Actions, Zod

---

## Review Triage

### Confirmed / Worth Doing

- Checkpoint/resume semantics in [src/engine.ts](C:/Users/alex.rambasek/source/repos/dramaturge/src/engine.ts) and [src/checkpoint.ts](C:/Users/alex.rambasek/source/repos/dramaturge/src/checkpoint.ts) are vulnerable because the final checkpoint is written after `frontier.drain()`, so the last saved snapshot is no longer resumable.
- Silent API probe failures in [src/api/worker.ts](C:/Users/alex.rambasek/source/repos/dramaturge/src/api/worker.ts) hide transport/setup problems and make it hard to distinguish “no issue found” from “probes never really ran.”
- Bootstrap lifecycle handling in [src/engine.ts](C:/Users/alex.rambasek/source/repos/dramaturge/src/engine.ts) is fragile: ignored stdio, no early-exit monitoring, and no fetch timeout.
- The repo has a publish workflow in [.github/workflows/publish.yml](C:/Users/alex.rambasek/source/repos/dramaturge/.github/workflows/publish.yml), but no normal PR/branch CI.
- Header/body redaction in [src/network/traffic-observer.ts](C:/Users/alex.rambasek/source/repos/dramaturge/src/network/traffic-observer.ts) and [src/api/assertions.ts](C:/Users/alex.rambasek/source/repos/dramaturge/src/api/assertions.ts) is too narrow for CSRF and custom auth headers.
- Runtime `any` usage is still concentrated around Stagehand and Playwright boundaries and is worth reducing where it affects correctness and maintainability.
- Console warnings are currently promoted into findings in [src/browser-errors.ts](C:/Users/alex.rambasek/source/repos/dramaturge/src/browser-errors.ts), which is likely too noisy as the default posture.

### Reframe, Don’t Implement Literally

- The review’s “use `browserContext.request` instead of `page.request`” suggestion is **not literally correct** as written. Playwright’s docs say `browserContext.request` and `page.request` both share cookie storage with the corresponding browser context, so a raw swap is not the main fix. The real improvement is to make the authenticated replay context explicit in our code and add an integration test proving auth replay semantics. Source: Playwright APIRequestContext docs: https://playwright.dev/docs/api/class-apirequestcontext
- The review’s “Stagehand always uses planner model” note is only **partially** true. Dramaturge already passes per-worker models into `stagehand.agent({ model })` in [src/worker/worker.ts](C:/Users/alex.rambasek/source/repos/dramaturge/src/worker/worker.ts), but the base `Stagehand` instance in [src/engine/worker-pool.ts](C:/Users/alex.rambasek/source/repos/dramaturge/src/engine/worker-pool.ts) is still created with `config.models.planner`, so `act()`-based navigation/auth/bootstrap work stays planner-biased. Stagehand’s docs confirm the default agent uses the Stagehand constructor model, while `agent({ model })` can override it. Source: Stagehand model docs: https://docs.stagehand.dev/configuration/models
- Synchronous filesystem access is not an urgent bug right now. It should be isolated behind a smaller storage seam, but it should stay behind correctness, observability, and CI work.

---

## File Map

### Core runtime and checkpointing

- Modify: [src/engine.ts](C:/Users/alex.rambasek/source/repos/dramaturge/src/engine.ts)
- Modify: [src/checkpoint.ts](C:/Users/alex.rambasek/source/repos/dramaturge/src/checkpoint.ts)
- Modify: [src/checkpoint.test.ts](C:/Users/alex.rambasek/source/repos/dramaturge/src/checkpoint.test.ts)
- Optional Create: [src/engine/bootstrap.ts](C:/Users/alex.rambasek/source/repos/dramaturge/src/engine/bootstrap.ts)
- Optional Create: [src/engine/bootstrap.test.ts](C:/Users/alex.rambasek/source/repos/dramaturge/src/engine/bootstrap.test.ts)

### API replay and probe telemetry

- Modify: [src/engine/execute-frontier-item.ts](C:/Users/alex.rambasek/source/repos/dramaturge/src/engine/execute-frontier-item.ts)
- Modify: [src/api/types.ts](C:/Users/alex.rambasek/source/repos/dramaturge/src/api/types.ts)
- Modify: [src/api/worker.ts](C:/Users/alex.rambasek/source/repos/dramaturge/src/api/worker.ts)
- Modify: [src/api/replay.ts](C:/Users/alex.rambasek/source/repos/dramaturge/src/api/replay.ts)
- Modify: [src/api/worker.test.ts](C:/Users/alex.rambasek/source/repos/dramaturge/src/api/worker.test.ts)
- Modify: [src/api/replay.test.ts](C:/Users/alex.rambasek/source/repos/dramaturge/src/api/replay.test.ts)
- Optional Create: [src/api/diagnostics.ts](C:/Users/alex.rambasek/source/repos/dramaturge/src/api/diagnostics.ts)

### Stagehand model roles and typing seams

- Modify: [src/config.ts](C:/Users/alex.rambasek/source/repos/dramaturge/src/config.ts)
- Modify: [src/engine/worker-pool.ts](C:/Users/alex.rambasek/source/repos/dramaturge/src/engine/worker-pool.ts)
- Modify: [src/worker/worker.ts](C:/Users/alex.rambasek/source/repos/dramaturge/src/worker/worker.ts)
- Modify: [src/auth/form.ts](C:/Users/alex.rambasek/source/repos/dramaturge/src/auth/form.ts)
- Modify: [src/auth/oauth-redirect.ts](C:/Users/alex.rambasek/source/repos/dramaturge/src/auth/oauth-redirect.ts)
- Modify: [src/browser-errors.ts](C:/Users/alex.rambasek/source/repos/dramaturge/src/browser-errors.ts)
- Modify: [src/network/traffic-observer.ts](C:/Users/alex.rambasek/source/repos/dramaturge/src/network/traffic-observer.ts)
- Optional Create: [src/stagehand/playwright-bridge.ts](C:/Users/alex.rambasek/source/repos/dramaturge/src/stagehand/playwright-bridge.ts)

### Reporting policy, sanitization, and CI

- Modify: [src/config.ts](C:/Users/alex.rambasek/source/repos/dramaturge/src/config.ts)
- Modify: [src/browser-errors.ts](C:/Users/alex.rambasek/source/repos/dramaturge/src/browser-errors.ts)
- Modify: [src/browser-errors.test.ts](C:/Users/alex.rambasek/source/repos/dramaturge/src/browser-errors.test.ts)
- Modify: [src/network/traffic-observer.ts](C:/Users/alex.rambasek/source/repos/dramaturge/src/network/traffic-observer.ts)
- Modify: [src/network/traffic-observer.test.ts](C:/Users/alex.rambasek/source/repos/dramaturge/src/network/traffic-observer.test.ts)
- Modify: [src/api/assertions.ts](C:/Users/alex.rambasek/source/repos/dramaturge/src/api/assertions.ts)
- Create: [.github/workflows/ci.yml](C:/Users/alex.rambasek/source/repos/dramaturge/.github/workflows/ci.yml)
- Modify: [README.md](C:/Users/alex.rambasek/source/repos/dramaturge/README.md)

---

## PR Sequence

## Chunk 1: Resume Correctness

### PR 1: Make Final Checkpoints Resumable

**Why first:** This is the only review item that directly threatens long-running runs and can silently invalidate the resume feature.

**Files:**
- Modify: [src/engine.ts](C:/Users/alex.rambasek/source/repos/dramaturge/src/engine.ts)
- Modify: [src/checkpoint.ts](C:/Users/alex.rambasek/source/repos/dramaturge/src/checkpoint.ts)
- Modify: [src/checkpoint.test.ts](C:/Users/alex.rambasek/source/repos/dramaturge/src/checkpoint.test.ts)

- [ ] **Step 1: Add a failing regression test for the final-checkpoint case**

Add a test that simulates:
- pending frontier items remain at shutdown
- engine writes a final checkpoint
- loading that checkpoint still restores those pending items

Representative test shape:

```ts
it("preserves pending frontier items in the final checkpoint", () => {
  // arrange frontier with pending items
  // act: save resumable checkpoint before report-time drain
  // assert: loadCheckpoint(...).frontierSnapshot still contains pending items
});
```

- [ ] **Step 2: Run the targeted test to see it fail**

Run: `pnpm test -- src/checkpoint.test.ts`

- [ ] **Step 3: Split resumable checkpointing from report-time frontier draining**

Preferred implementation:
- save a resumable checkpoint before `frontier.drain()`
- drain remaining work only after the resumable snapshot is written
- if needed, preserve report-only blind-spot generation separately from resume state

Representative runtime seam:

```ts
saveCheckpoint(...);
const remaining = ctx.frontier.drain();
```

or, if a dual-artifact approach is cleaner:

```ts
saveCheckpoint({ mode: "resume", frontier });
const remaining = frontier.drain();
saveCheckpoint({ mode: "report", frontier });
```

- [ ] **Step 4: Re-run targeted tests**

Run: `pnpm test -- src/checkpoint.test.ts`

- [ ] **Step 5: Sanity-check resume behavior against reporting behavior**

Manual/code review checklist:
- confirm resuming a timed-out run keeps pending work
- confirm blind spots still appear in reports
- confirm `completedTaskIds` and planner state are unchanged
- confirm checkpoint snapshots still serialize with the existing version unless a format bump is truly necessary

- [ ] **Step 6: Commit**

```bash
git add src/engine.ts src/checkpoint.ts src/checkpoint.test.ts
git commit -m "Preserve resumable frontier state in final checkpoints"
```

---

## Chunk 2: API Replay Reliability and Visibility

### PR 2: Make Authenticated Replay Context Explicit

**Why second:** The review found a real reliability concern here, but the literal recommendation needs reframing.

**Files:**
- Modify: [src/engine/execute-frontier-item.ts](C:/Users/alex.rambasek/source/repos/dramaturge/src/engine/execute-frontier-item.ts)
- Modify: [src/api/types.ts](C:/Users/alex.rambasek/source/repos/dramaturge/src/api/types.ts)
- Modify: [src/api/replay.ts](C:/Users/alex.rambasek/source/repos/dramaturge/src/api/replay.ts)
- Modify: [src/api/worker.test.ts](C:/Users/alex.rambasek/source/repos/dramaturge/src/api/worker.test.ts)
- Modify: [src/api/replay.test.ts](C:/Users/alex.rambasek/source/repos/dramaturge/src/api/replay.test.ts)

- [ ] **Step 1: Add a failing test that encodes the intended replay contract**

Test for:
- authenticated replay uses the browser-bound request context
- isolated unauthenticated probes use their own context
- request construction preserves headers/body/query data

Representative interface:

```ts
export interface ExecuteApiWorkerTaskInput {
  authenticatedRequestContext: ApiRequestContextLike;
  createIsolatedRequestContext?: () => Promise<ApiRequestContextLike>;
}
```

- [ ] **Step 2: Run targeted API replay tests**

Run: `pnpm test -- src/api/replay.test.ts src/api/worker.test.ts`

- [ ] **Step 3: Replace the ambiguous `pageRequestContext` naming with an explicit authenticated replay seam**

Important: do **not** make a noisy mechanical swap just for appearances. The code should reflect the semantic intent:
- authenticated probes reuse browser-context auth
- isolated probes stay isolated

If the page-scoped request context is the right implementation detail, keep it behind a clearer abstraction.

- [ ] **Step 4: Add an auth replay integration-style test**

The test should prove:
- browser-authenticated state is visible to the authenticated request context
- isolated unauthenticated context does **not** inherit that state

- [ ] **Step 5: Sanity-check compatibility with the current probe pipeline**

Manual/code review checklist:
- confirm contract replay still uses the authenticated path
- confirm auth-boundary probes still use the isolated path
- confirm existing request fidelity fixes are preserved
- confirm no change regresses the current redirect-to-login handling

- [ ] **Step 6: Commit**

```bash
git add src/engine/execute-frontier-item.ts src/api/types.ts src/api/replay.ts src/api/replay.test.ts src/api/worker.test.ts
git commit -m "Clarify authenticated API replay context"
```

### PR 3: Add API Probe Diagnostics Instead of Swallowing Failures

**Files:**
- Modify: [src/api/worker.ts](C:/Users/alex.rambasek/source/repos/dramaturge/src/api/worker.ts)
- Optional Create: [src/api/diagnostics.ts](C:/Users/alex.rambasek/source/repos/dramaturge/src/api/diagnostics.ts)
- Modify: [src/api/worker.test.ts](C:/Users/alex.rambasek/source/repos/dramaturge/src/api/worker.test.ts)
- Modify: [src/report/json.ts](C:/Users/alex.rambasek/source/repos/dramaturge/src/report/json.ts) if diagnostics should surface in reports

- [ ] **Step 1: Add a failing test for probe failure visibility**

Expected shape:

```ts
expect(result.summary).toContain("attempted");
expect(result.summary).toContain("failed");
```

or a structured form:

```ts
apiDiagnostics: {
  attempted: 6,
  succeeded: 4,
  failed: 2,
}
```

- [ ] **Step 2: Run the failing test**

Run: `pnpm test -- src/api/worker.test.ts`

- [ ] **Step 3: Implement non-noisy diagnostics**

Capture counts and a small bounded failure sample set. Do **not** turn every transient network exception into a separate finding by default.

Suggested structure:

```ts
interface ApiProbeDiagnostics {
  attempted: number;
  succeeded: number;
  failed: number;
  recentFailures: string[];
}
```

- [ ] **Step 4: Re-run targeted tests**

Run: `pnpm test -- src/api/worker.test.ts`

- [ ] **Step 5: Sanity-check reporting and planner compatibility**

Manual/code review checklist:
- confirm “no eligible API probes” and “all probes failed” are distinguishable
- confirm diagnostics do not get misinterpreted as findings
- confirm report JSON remains backward-compatible if new fields are optional

- [ ] **Step 6: Commit**

```bash
git add src/api/worker.ts src/api/worker.test.ts src/api/diagnostics.ts src/report/json.ts
git commit -m "Expose API probe diagnostics"
```

---

## Chunk 3: Runtime Model Roles and Bootstrap Hardening

### PR 4: Split Base Stagehand Model From Worker Agent Model

**Files:**
- Modify: [src/config.ts](C:/Users/alex.rambasek/source/repos/dramaturge/src/config.ts)
- Modify: [src/engine/worker-pool.ts](C:/Users/alex.rambasek/source/repos/dramaturge/src/engine/worker-pool.ts)
- Modify: [src/engine/worker-pool.test.ts](C:/Users/alex.rambasek/source/repos/dramaturge/src/engine/worker-pool.test.ts)
- Modify: [README.md](C:/Users/alex.rambasek/source/repos/dramaturge/README.md)

- [ ] **Step 1: Add a failing config/runtime test**

The test should prove:
- `stagehand.agent({ model })` still uses per-worker models
- base `Stagehand` instances can be configured independently for `act()`/navigation/auth paths

- [ ] **Step 2: Run targeted tests**

Run: `pnpm test -- src/engine/worker-pool.test.ts`

- [ ] **Step 3: Introduce an explicit base-model config**

Suggested minimal config addition:

```ts
models: {
  planner: string;
  worker: string;
  browserOps?: string;
  workers?: { ... };
}
```

Use `browserOps` for:
- `new Stagehand({ model })`
- navigation-time `stagehand.act()`
- auth/bootstrap interactions

Keep fallback behavior:
- `browserOps ?? planner`

- [ ] **Step 4: Re-run targeted tests**

Run: `pnpm test -- src/engine/worker-pool.test.ts`

- [ ] **Step 5: Sanity-check navigation/auth compatibility**

Manual/code review checklist:
- confirm login/auth flows still work with default config
- confirm navigation hint following still uses a valid model
- confirm agent-level worker models still override properly

- [ ] **Step 6: Commit**

```bash
git add src/config.ts src/engine/worker-pool.ts src/engine/worker-pool.test.ts README.md
git commit -m "Separate Stagehand browser-ops model from worker agent models"
```

### PR 5: Harden Bootstrap Process Supervision

**Files:**
- Modify: [src/engine.ts](C:/Users/alex.rambasek/source/repos/dramaturge/src/engine.ts)
- Optional Create: [src/engine/bootstrap.ts](C:/Users/alex.rambasek/source/repos/dramaturge/src/engine/bootstrap.ts)
- Optional Create: [src/engine/bootstrap.test.ts](C:/Users/alex.rambasek/source/repos/dramaturge/src/engine/bootstrap.test.ts)
- Modify: [src/config.ts](C:/Users/alex.rambasek/source/repos/dramaturge/src/config.ts) if extra bootstrap config is needed

- [ ] **Step 1: Add failing tests for timeout and early-exit behavior**

Cases:
- bootstrap child exits before ready
- ready URL hangs forever
- ready indicator never appears

- [ ] **Step 2: Run targeted tests**

Run: `pnpm test -- src/engine/bootstrap.test.ts`

- [ ] **Step 3: Extract bootstrap supervision into a focused helper**

The helper should:
- capture stdout/stderr into bounded buffers
- detect early process exit
- use `AbortController` for fetch timeout
- surface the last bootstrap logs in thrown errors

Representative seam:

```ts
interface BootstrapStatus {
  process?: ChildProcess;
  recentStdout: string[];
  recentStderr: string[];
}
```

- [ ] **Step 4: Re-run targeted tests**

Run: `pnpm test -- src/engine/bootstrap.test.ts`

- [ ] **Step 5: Sanity-check platform behavior**

Manual/code review checklist:
- confirm Windows `taskkill` cleanup still works
- confirm local bootstrap logs do not explode report size
- confirm bootstrap failures are visible without breaking non-bootstrap runs

- [ ] **Step 6: Commit**

```bash
git add src/engine.ts src/engine/bootstrap.ts src/engine/bootstrap.test.ts src/config.ts
git commit -m "Supervise bootstrap processes explicitly"
```

---

## Chunk 4: CI, Sanitization, and Report Noise

### PR 6: Add Normal CI For Pull Requests and Main Branch

**Files:**
- Create: [.github/workflows/ci.yml](C:/Users/alex.rambasek/source/repos/dramaturge/.github/workflows/ci.yml)
- Modify: [README.md](C:/Users/alex.rambasek/source/repos/dramaturge/README.md)

- [ ] **Step 1: Add a CI workflow**

Required jobs:
- checkout
- pnpm setup
- Node setup
- install
- test
- build
- standalone verify

- [ ] **Step 2: Validate workflow locally as far as practical**

Run locally:
- `pnpm test`
- `pnpm build`
- `pnpm run verify:standalone`

- [ ] **Step 3: Sanity-check workflow overlap with publish**

Manual/code review checklist:
- ensure CI does not duplicate package publish logic
- ensure CI runs on PRs and `main`, while publish remains tag/manual driven
- ensure cache paths and Node version align with `packageManager`

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml README.md
git commit -m "Add CI validation workflow"
```

### PR 7: Expand Redaction and Make Console Warnings Non-Default Findings

**Files:**
- Modify: [src/config.ts](C:/Users/alex.rambasek/source/repos/dramaturge/src/config.ts)
- Modify: [src/browser-errors.ts](C:/Users/alex.rambasek/source/repos/dramaturge/src/browser-errors.ts)
- Modify: [src/browser-errors.test.ts](C:/Users/alex.rambasek/source/repos/dramaturge/src/browser-errors.test.ts)
- Modify: [src/network/traffic-observer.ts](C:/Users/alex.rambasek/source/repos/dramaturge/src/network/traffic-observer.ts)
- Modify: [src/network/traffic-observer.test.ts](C:/Users/alex.rambasek/source/repos/dramaturge/src/network/traffic-observer.test.ts)
- Modify: [src/api/assertions.ts](C:/Users/alex.rambasek/source/repos/dramaturge/src/api/assertions.ts)
- Modify: [README.md](C:/Users/alex.rambasek/source/repos/dramaturge/README.md)

- [ ] **Step 1: Add failing tests for broader redaction and warning policy**

Tests should cover:
- `x-csrf-token`, `x-xsrf-token`, `csrf-token`, `x-api-key`, and similar custom auth headers are redacted
- console warnings no longer become findings by default
- console warnings can still be enabled explicitly

- [ ] **Step 2: Run targeted tests**

Run: `pnpm test -- src/browser-errors.test.ts src/network/traffic-observer.test.ts`

- [ ] **Step 3: Add explicit config for warning handling**

Suggested shape:

```ts
autoCapture: {
  consoleErrors: true,
  consoleWarnings: false,
  networkErrors: true,
}
```

or an equivalent policy enum if that reads cleaner.

- [ ] **Step 4: Convert redaction to a small central policy**

Prefer a shared helper over duplicate regex drift.

- [ ] **Step 5: Re-run targeted tests**

Run: `pnpm test -- src/browser-errors.test.ts src/network/traffic-observer.test.ts`

- [ ] **Step 6: Sanity-check signal/noise tradeoffs**

Manual/code review checklist:
- confirm uncaught exceptions still surface prominently
- confirm network 4xx/5xx behavior is unchanged unless intentionally re-scoped
- confirm redaction does not strip ordinary debugging headers that are useful in reports

- [ ] **Step 7: Commit**

```bash
git add src/config.ts src/browser-errors.ts src/browser-errors.test.ts src/network/traffic-observer.ts src/network/traffic-observer.test.ts src/api/assertions.ts README.md
git commit -m "Reduce browser warning noise and broaden sensitive-header redaction"
```

---

## Chunk 5: Type-Safety and IO Seams

### PR 8: Replace High-Value Runtime `any` Seams With Typed Bridges

**Why last:** This is worthwhile, but it should not delay correctness or operational fixes.

**Files:**
- Optional Create: [src/stagehand/playwright-bridge.ts](C:/Users/alex.rambasek/source/repos/dramaturge/src/stagehand/playwright-bridge.ts)
- Modify: [src/browser-errors.ts](C:/Users/alex.rambasek/source/repos/dramaturge/src/browser-errors.ts)
- Modify: [src/network/traffic-observer.ts](C:/Users/alex.rambasek/source/repos/dramaturge/src/network/traffic-observer.ts)
- Modify: [src/auth/form.ts](C:/Users/alex.rambasek/source/repos/dramaturge/src/auth/form.ts)
- Modify: [src/auth/oauth-redirect.ts](C:/Users/alex.rambasek/source/repos/dramaturge/src/auth/oauth-redirect.ts)
- Modify: [src/engine/execute-frontier-item.ts](C:/Users/alex.rambasek/source/repos/dramaturge/src/engine/execute-frontier-item.ts)
- Modify: [src/coverage/accessibility.ts](C:/Users/alex.rambasek/source/repos/dramaturge/src/coverage/accessibility.ts)
- Modify: [src/coverage/visual-regression.ts](C:/Users/alex.rambasek/source/repos/dramaturge/src/coverage/visual-regression.ts)

- [ ] **Step 1: Identify the runtime `any` hotspots**

Focus on production code first, not tests.

- [ ] **Step 2: Introduce narrow interfaces instead of leaking raw `any`**

Representative example:

```ts
export interface StagehandPageLike {
  url(): string;
  goto(url: string): Promise<unknown>;
  evaluate?<T>(fn: string | ((...args: unknown[]) => T), ...args: unknown[]): Promise<T>;
  request?: ApiRequestContextLike;
  on?(event: string, listener: (...args: unknown[]) => void): void;
  off?(event: string, listener: (...args: unknown[]) => void): void;
}
```

- [ ] **Step 3: Re-run the directly affected tests**

Run:
- `pnpm test -- src/browser-errors.test.ts`
- `pnpm test -- src/network/traffic-observer.test.ts`
- `pnpm test -- src/auth/form.test.ts src/auth/oauth-redirect.test.ts`

- [ ] **Step 4: Isolate sync FS behind helper seams where reasonable**

Do not convert the whole repo to async IO in this PR. Just reduce spread:
- config load helper
- checkpoint store helper
- memory store helper

- [ ] **Step 5: Sanity-check maintainability**

Manual/code review checklist:
- confirm no runtime feature lost access to Stagehand/Playwright APIs it needs
- confirm test mocks got easier, not harder, to express
- confirm public API/config surface did not change unnecessarily

- [ ] **Step 6: Commit**

```bash
git add src/stagehand/playwright-bridge.ts src/browser-errors.ts src/network/traffic-observer.ts src/auth/form.ts src/auth/oauth-redirect.ts src/engine/execute-frontier-item.ts src/coverage/accessibility.ts src/coverage/visual-regression.ts
git commit -m "Introduce typed Stagehand and Playwright runtime bridges"
```

---

## Final Verification Gate

- [ ] Run: `pnpm test`
- [ ] Run: `pnpm build`
- [ ] Run: `pnpm run verify:standalone`
- [ ] Manual sanity run:
  - authenticated target with `apiTesting.enabled: true`
  - bootstrap-enabled target if available
  - stop a run early and confirm resume preserves pending work
- [ ] Review generated reports for:
  - reduced console-warning noise
  - preserved API replay findings
  - visible API probe diagnostics
  - no leaked sensitive headers/tokens

---

## Notes for the Implementer

- Do **not** implement the review’s API replay suggestion as a cosmetic `page.request` -> `browserContext.request` diff. The important change is explicit semantics plus coverage, because Playwright documents both as browser-context-sharing request contexts.
- Do **not** remove synchronous IO wholesale in the same stack. Keep that as seam cleanup, not a repo-wide churn event.
- Keep commits frequent and scoped to the PR boundaries above.
- If a fix forces a serialization/schema change, update tests first and prefer backward-compatible loading where practical.

Plan complete and saved to `docs/superpowers/plans/2026-03-30-dramaturge-review-driven-hardening.md`. Ready to execute?
