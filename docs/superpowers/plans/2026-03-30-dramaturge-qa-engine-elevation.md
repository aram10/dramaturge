# Dramaturge QA Engine Elevation Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn Dramaturge into a polished hybrid QA engine with a stronger oracle model, active API verification, adversarial exploration, dual-pass judgment, better regression-test generation, and a clearer broad-applicability story.

**Architecture:** Introduce a normalized spec/oracle layer that all runtime subsystems can share. Keep deterministic validators and traces at the center, then layer LLM-based prioritization and judging on top. Ship in PR-sized chunks with explicit review gates so the existing browser exploration, memory, and report pipeline stay stable while the architecture grows.

**Tech Stack:** TypeScript, Playwright, Stagehand, Zod, Vitest, existing Dramaturge runtime. Planned dependency spikes and likely additions: `ajv`, `openapi-backend`, `oas`, `fast-check`.

---

## Scope and sequencing

This plan intentionally ships substance before messaging. Do not update the package positioning to claim hybrid UI/API QA, adversarial coverage, or broad applicability until the relevant PRs below are merged and their review gates pass.

### PR sequence summary

1. **PR 1:** Evaluation spine + normalized spec foundation
2. **PR 2:** OpenAPI/repo contract ingestion + validator plumbing
3. **PR 3:** Active API worker + cross-layer correlation
4. **PR 4:** Adversarial worker + safe stateful probes
5. **PR 5:** Explorer/Judge split + trace-backed evidence
6. **PR 6:** Assertion-bearing generated tests + generic adapter + positioning pass

### Compatibility hotspots to watch throughout

- `src/types.ts` is the shared blast radius for worker types, findings, and report metadata.
- `src/planner/planner.ts` and `src/engine.ts` must remain aligned on worker scheduling semantics.
- `src/engine/execute-frontier-item.ts`, `src/worker/worker.ts`, and `src/report/*` will evolve together as runtime artifacts become richer.
- `src/memory/store.ts` and `src/checkpoint.ts` must remain forward-compatible when new task/result types are added.
- `src/config.ts`, `dramaturge.config.example.json`, and `README.md` must move together whenever runtime behavior or defaults change.

## Chunk 1: PR 1 - Evaluation spine + normalized spec foundation

**PR Goal:** Give the project a repeatable way to measure progress and a single internal schema for “what the app is expected to do.”

**Files:**
- Create: `src/evals/types.ts`
- Create: `src/evals/harness.ts`
- Create: `src/evals/harness.test.ts`
- Create: `src/evals/fixtures.ts`
- Create: `src/spec/types.ts`
- Create: `src/spec/normalized-spec.ts`
- Create: `src/spec/repo-spec.ts`
- Create: `src/spec/openapi-spec.ts`
- Create: `src/spec/validators.ts`
- Create: `src/spec/repo-spec.test.ts`
- Create: `src/spec/openapi-spec.test.ts`
- Modify: `src/adaptation/types.ts`
- Modify: `src/adaptation/repo-scan.ts`
- Modify: `src/adaptation/nextjs.ts`
- Modify: `src/config.ts`
- Modify: `src/config.test.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Write failing tests for the normalized spec model**

```ts
expect(buildRepoSpec(repoHints).operations["POST /api/widgets"]).toMatchObject({
  authRequired: true,
  requestBody: { required: true },
  responses: { "200": expect.any(Object), "400": expect.any(Object) },
});
```

- [ ] **Step 2: Define the normalized spec types**

```ts
export interface NormalizedOperationSpec {
  id: string;
  method: string;
  route: string;
  source: "repo" | "openapi" | "traffic" | "inferred";
  authRequired?: boolean;
  requestBodySchema?: JsonSchema;
  responseSchemas: Record<string, JsonSchema | undefined>;
  queryParams: NormalizedParamSpec[];
  pathParams: NormalizedParamSpec[];
}
```

- [ ] **Step 3: Add config support for external specs without making them mandatory**

```ts
const RepoContextSchema = z.object({
  root: z.string().optional(),
  framework: z.enum(["auto", "nextjs", "generic"]).default("auto"),
  hintsFile: z.string().optional(),
  specFile: z.string().optional(),
});
```

- [ ] **Step 4: Convert repo-derived hints into a `NormalizedSpecArtifact`**
- [ ] **Step 5: Add the eval harness that can run golden scenarios and emit a small summary object**
- [ ] **Step 6: Export the new types/helpers from `src/index.ts`**
- [ ] **Step 7: Run targeted tests**

Run: `pnpm exec vitest run src/spec/repo-spec.test.ts src/spec/openapi-spec.test.ts src/evals/harness.test.ts src/config.test.ts`

Expected: all new spec/eval tests pass and no config regressions appear.

- [ ] **Step 8: Run package-wide verification**

Run: `pnpm test`
Run: `pnpm build`
Run: `pnpm run verify:standalone`

- [ ] **Step 9: Commit**

```bash
git add src/evals src/spec src/adaptation src/config.ts src/config.test.ts src/index.ts
git commit -m "feat: add normalized spec foundation and eval harness"
```

### Sanity Check / Review Gate

- Confirm `repoContext.framework = "generic"` still behaves as a no-op instead of forcing a broken partial parser.
- Confirm no run starts failing when `repoContext` is absent.
- Confirm `src/adaptation/nextjs.ts` still produces the same current hints for existing tests before adding richer spec data.
- Review whether `NormalizedSpecArtifact` is small enough to pass around without prompt bloat; if not, add a summarized prompt projection now rather than later.

## Chunk 2: PR 2 - OpenAPI/repo contract ingestion + validator plumbing

**PR Goal:** Make the spec layer actually useful by turning repo and spec-file data into runtime validators.

**Files:**
- Create: `src/spec/json-schema.ts`
- Create: `src/spec/ajv.ts`
- Create: `src/spec/openapi-loader.ts`
- Create: `src/spec/openapi-loader.test.ts`
- Create: `src/spec/contract-index.ts`
- Modify: `src/spec/repo-spec.ts`
- Modify: `src/spec/openapi-spec.ts`
- Modify: `src/spec/validators.ts`
- Modify: `src/api/contract-oracle.ts`
- Modify: `src/worker/prompts.ts`
- Modify: `src/worker/prompts.test.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Write failing tests for request/response schema validation**

```ts
const result = validateOperationResponse(contractIndex, "POST", "/api/widgets", 500, {
  message: "boom",
});
expect(result.ok).toBe(false);
```

- [ ] **Step 2: Add a contract index that can answer “what operation spec applies to this request?”**
- [ ] **Step 3: Convert Zod-derived schemas and spec-file schemas into one validator interface**
- [ ] **Step 4: Refactor `src/api/contract-oracle.ts` to depend on the contract index instead of raw repo hints**
- [ ] **Step 5: Feed condensed spec expectations into worker prompts, but keep prompt size bounded**
- [ ] **Step 6: Run targeted tests**

Run: `pnpm exec vitest run src/spec/openapi-loader.test.ts src/spec/openapi-spec.test.ts src/worker/prompts.test.ts src/api/contract-oracle.test.ts`

- [ ] **Step 7: Run package-wide verification**

Run: `pnpm test`
Run: `pnpm build`

- [ ] **Step 8: Commit**

```bash
git add src/spec src/api/contract-oracle.ts src/worker/prompts.ts src/index.ts
git commit -m "feat: validate repo and spec contracts at runtime"
```

### Sanity Check / Review Gate

- Review OpenAPI parser choice before merging. Do not lock in a library that narrows the support story.
- Confirm the contract oracle still produces useful findings when no external spec file exists.
- Confirm validator failures do not leak huge request/response payloads into reports or prompts.
- Confirm current report renderers still tolerate richer contract evidence without broken grouping or dedupe.

## Chunk 3: PR 3 - Active API worker + cross-layer correlation

**PR Goal:** Add a real API-testing path rather than only observing traffic after browser exploration.

**Files:**
- Create: `src/api/types.ts`
- Create: `src/api/worker.ts`
- Create: `src/api/replay.ts`
- Create: `src/api/probes.ts`
- Create: `src/api/assertions.ts`
- Create: `src/api/correlation.ts`
- Create: `src/api/worker.test.ts`
- Create: `src/api/replay.test.ts`
- Modify: `src/types.ts`
- Modify: `src/config.ts`
- Modify: `src/config.test.ts`
- Modify: `src/planner/planner.ts`
- Modify: `src/planner/planner.test.ts`
- Modify: `src/engine/execute-frontier-item.ts`
- Modify: `src/engine.ts`
- Modify: `src/network/traffic-observer.ts`
- Modify: `src/network/traffic-observer.test.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Add `api` as a worker type and write failing planner tests**

```ts
expect(tasks.map((task) => task.workerType)).toContain("api");
```

- [ ] **Step 2: Add config for safe API testing defaults**

```ts
apiTesting: {
  enabled: false,
  maxEndpointsPerNode: 4,
  maxProbeCasesPerEndpoint: 6,
  unauthenticatedProbes: true,
  allowMutatingProbes: false,
}
```

- [ ] **Step 3: Implement authenticated replay using the shared Playwright request context**

```ts
const response = await page.request.fetch(observed.request, {
  data: mutatedBody,
});
```

- [ ] **Step 4: Implement isolated unauthenticated probes with a separate request context**
- [ ] **Step 5: Correlate API failures back to UI findings and pages**
- [ ] **Step 6: Limit request-body capture size and redact obvious secrets before persisting artifacts**
- [ ] **Step 7: Run targeted tests**

Run: `pnpm exec vitest run src/api/worker.test.ts src/api/replay.test.ts src/planner/planner.test.ts src/network/traffic-observer.test.ts src/config.test.ts`

- [ ] **Step 8: Run package-wide verification**

Run: `pnpm test`
Run: `pnpm build`
Run: `pnpm run verify:standalone`

- [ ] **Step 9: Commit**

```bash
git add src/api src/types.ts src/config.ts src/planner src/engine src/network src/index.ts
git commit -m "feat: add active api worker and cross-layer correlation"
```

### Sanity Check / Review Gate

- Verify browser auth state and API worker auth state match for authenticated probes.
- Verify isolated unauthenticated probes do not accidentally inherit browser cookies.
- Review mutation safety: POST/PUT/PATCH probes must stay disabled by default unless the plan explicitly enables them.
- Confirm worker-pool concurrency still behaves correctly when API workers and browser workers run in the same planner loop.
- Inspect one real report manually to ensure UI findings and API findings are not duplicative noise.

## Chunk 4: PR 4 - Adversarial worker + safe stateful probes

**PR Goal:** Add systematic edge-case, stale-state, and race-condition probing without making the tool reckless.

**Files:**
- Create: `src/adversarial/payloads.ts`
- Create: `src/adversarial/scenarios.ts`
- Create: `src/adversarial/stateful.ts`
- Create: `src/adversarial/concurrency.ts`
- Create: `src/adversarial/payloads.test.ts`
- Create: `src/adversarial/scenarios.test.ts`
- Modify: `src/types.ts`
- Modify: `src/config.ts`
- Modify: `src/config.test.ts`
- Modify: `src/planner/planner.ts`
- Modify: `src/planner/priority.ts`
- Modify: `src/worker/prompts.ts`
- Modify: `src/worker/worker.ts`

- [ ] **Step 1: Add `adversarial` as a worker type and write failing planner tests**
- [ ] **Step 2: Add config for safe adversarial defaults**

```ts
adversarial: {
  enabled: false,
  maxSequencesPerNode: 3,
  safeMode: true,
  includeAuthzProbes: false,
  includeConcurrencyProbes: false,
}
```

- [ ] **Step 3: Implement curated payload families**
- [ ] **Step 4: Implement stateful scenarios like stale-detail pages, double-submit, and back-button resubmission**
- [ ] **Step 5: Add optional concurrency probes guarded by config**
- [ ] **Step 6: Route only low-priority adversarial tasks by default so core exploration still happens first**
- [ ] **Step 7: Run targeted tests**

Run: `pnpm exec vitest run src/adversarial/payloads.test.ts src/adversarial/scenarios.test.ts src/planner/planner.test.ts src/config.test.ts`

- [ ] **Step 8: Run package-wide verification**

Run: `pnpm test`
Run: `pnpm build`

- [ ] **Step 9: Commit**

```bash
git add src/adversarial src/types.ts src/config.ts src/planner src/worker
git commit -m "feat: add adversarial worker and safe stateful probes"
```

### Sanity Check / Review Gate

- Confirm `destructiveActionsAllowed` still overrides everything and that adversarial flows cannot silently bypass it.
- Manually inspect whether adversarial prompts are causing Stagehand to thrash or loop.
- Confirm checkpoint/resume still works when adversarial tasks are pending or partially completed.
- Review whether concurrency probes should be a separate follow-up PR if they destabilize CI or local runs.

## Chunk 5: PR 5 - Explorer/Judge split + trace-backed evidence

**PR Goal:** Improve precision by separating evidence collection from verdict generation.

**Files:**
- Create: `src/judge/types.ts`
- Create: `src/judge/prompt.ts`
- Create: `src/judge/judge.ts`
- Create: `src/judge/judge.test.ts`
- Create: `src/judge/bundle.ts`
- Modify: `src/types.ts`
- Modify: `src/worker/tools.ts`
- Modify: `src/worker/worker.ts`
- Modify: `src/engine/execute-frontier-item.ts`
- Modify: `src/report/collector.ts`
- Modify: `src/report/json.ts`
- Modify: `src/report/markdown.ts`
- Modify: `src/engine/reports.ts`
- Modify: `src/config.ts`
- Modify: `src/config.test.ts`

- [ ] **Step 1: Write failing tests for the observation-to-judgment handoff**

```ts
expect(result.findings[0]?.verdict?.hypothesis).toContain("should");
expect(result.findings[0]?.meta?.source).toBe("agent");
```

- [ ] **Step 2: Introduce an `Observation` artifact separate from `RawFinding`**
- [ ] **Step 3: Refactor the worker so the explorer logs observations and artifacts, not final findings**
- [ ] **Step 4: Add a judge pass that turns observations plus deterministic artifacts into final findings**
- [ ] **Step 5: Add trace bundle support so each judged finding can point back to richer evidence**
- [ ] **Step 6: Add a fallback path: if the judge fails or times out, keep deterministic findings and mark explorer observations as unjudged**
- [ ] **Step 7: Run targeted tests**

Run: `pnpm exec vitest run src/judge/judge.test.ts src/worker/worker.test.ts src/report/collector.test.ts src/report/json.test.ts src/report/markdown.test.ts`

- [ ] **Step 8: Run package-wide verification**

Run: `pnpm test`
Run: `pnpm build`
Run: `pnpm run verify:standalone`

- [ ] **Step 9: Commit**

```bash
git add src/judge src/types.ts src/worker src/engine/execute-frontier-item.ts src/report src/config.ts src/engine/reports.ts
git commit -m "feat: split explorer and judge with trace-backed evidence"
```

### Sanity Check / Review Gate

- Confirm report IDs, evidence IDs, and replayable action IDs are still stable after the two-pass flow.
- Confirm auto-captured findings from accessibility, visual regression, and API validation still render correctly when a judge pass exists.
- Confirm judge latency does not make the engine unusably slow; if it does, add a per-task judge budget before continuing.
- Manually compare at least five findings before and after the split to confirm precision improved instead of just making reports longer.

## Chunk 6: PR 6 - Assertion-bearing generated tests + generic adapter + positioning pass

**PR Goal:** Convert findings into more useful regression assets and make the support story honest.

**Files:**
- Create: `src/report/assertion-inference.ts`
- Create: `src/report/assertion-inference.test.ts`
- Create: `src/adaptation/generic.ts`
- Create: `src/adaptation/generic.test.ts`
- Modify: `src/report/test-gen.ts`
- Modify: `src/report/test-gen.test.ts`
- Modify: `src/adaptation/repo-scan.ts`
- Modify: `src/adaptation/types.ts`
- Modify: `src/config.ts`
- Modify: `dramaturge.config.example.json`
- Modify: `README.md`
- Modify: `package.json`

- [ ] **Step 1: Write failing tests that require real assertions in generated specs**

```ts
expect(generated.content).toContain('await expect(page.getByRole("alert")).toBeVisible()');
expect(generated.content).not.toContain("expect(true).toBe(true)");
```

- [ ] **Step 2: Infer assertions from verdicts, response artifacts, and DOM-oriented repro data**
- [ ] **Step 3: Add a generic adapter that can infer useful route and operation hints even when the repo is not Next.js**
- [ ] **Step 4: Update docs to declare a support matrix instead of implying universal support**
- [ ] **Step 5: Keep claims conservative until all six PRs are merged**
- [ ] **Step 6: Run targeted tests**

Run: `pnpm exec vitest run src/report/assertion-inference.test.ts src/report/test-gen.test.ts src/adaptation/generic.test.ts src/config.test.ts`

- [ ] **Step 7: Run package-wide verification**

Run: `pnpm test`
Run: `pnpm build`
Run: `pnpm run verify:standalone`
Run: `pnpm run pack:check`

- [ ] **Step 8: Commit**

```bash
git add src/report src/adaptation src/config.ts dramaturge.config.example.json README.md package.json
git commit -m "feat: generate asserted tests and broaden adapter support"
```

### Sanity Check / Review Gate

- Confirm generated tests still compile when the source finding lacks a perfect locator.
- Confirm the generic adapter does not degrade the existing Next.js repo-aware path.
- Review README claims line by line against actual shipped capability; remove any claim that depends on a not-yet-merged future idea.
- Manually run one generated test against a known repro to validate the end-to-end value proposition.

## Cross-PR review checklist

Apply this checklist before merging each PR:

- [ ] Existing `pnpm test` still passes.
- [ ] `pnpm build` still passes.
- [ ] `pnpm run verify:standalone` still passes for any PR that changes config, exports, docs, or packaging behavior.
- [ ] No new config field ships without a safe default.
- [ ] New runtime artifacts are either redacted, bounded in size, or both.
- [ ] Report output still degrades gracefully when optional features are disabled.
- [ ] Memory and checkpoint formats stay backward-compatible, or a versioned migration is added in the same PR.
- [ ] README/example config changes reflect only merged behavior, not planned behavior.

## Opinionated engineering notes

- Prefer deterministic validators over LLM judgment whenever both are available.
- Do not make the API worker LLM-driven in its first version. Keep replay/probe generation rule-based first.
- Do not merge the Explorer/Judge split unless evals show a measurable precision improvement.
- Keep mutating API probes and concurrency probes opt-in until there is strong evidence they are safe enough by default.
- If generic adapter work starts sprawling into framework-specific heuristics, stop and split the adapter matrix into separate follow-up PRs instead of hiding complexity behind `"generic"`.
- If any PR requires touching `src/types.ts`, `src/config.ts`, and `src/report/*` together, schedule extra human review because that usually means the runtime contract is changing.

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-03-30-dramaturge-qa-engine-elevation.md`. Execute in PR order. Do not skip the review gates.
