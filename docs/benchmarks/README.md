# Dramaturge Benchmarks

This directory contains benchmark configurations, results, and documentation for evaluating Dramaturge's signal-to-noise ratio and finding accuracy against well-known open-source applications.

## Purpose

These benchmarks serve to:

1. **Validate finding quality** — measure precision (% of findings that are real issues)
2. **Demonstrate recall** — measure coverage of known issues in test applications
3. **Categorize findings** — break down results by bug type (Bug, A11Y, UX, etc.)
4. **Track false positives** — document and classify noise patterns
5. **Measure performance** — track time to first actionable finding

## Benchmark Applications

We test against three well-known open-source applications:

### 1. TodoMVC (React & Vue)

**Why TodoMVC?**
- Simple, well-understood interface
- Minimal complexity → easier to validate findings
- Multiple framework implementations allow cross-validation
- Known baseline for CRUD testing

**What we test:**
- Form interactions (add, edit todos)
- State management (mark complete, filter)
- Accessibility (keyboard navigation, ARIA labels)
- Edge cases (empty states, long text)

### 2. RealWorld Demo (Conduit)

**Why RealWorld?**
- Medium.com clone with realistic complexity
- Full CRUD with articles, comments, follows
- Authentication flows
- Pagination and filtering
- Deployed public demo

**What we test:**
- Multi-step workflows (create article → publish → comment)
- API contract validation
- Auth boundary testing
- Navigation depth and state management
- User experience patterns

## Metrics Explained

### Precision

```
Precision = True Positives / (True Positives + False Positives)
```

**What it measures:** Of all the findings Dramaturge reports, how many are real issues?

**Target:** ≥ 70% precision is acceptable for exploratory QA; ≥ 85% is excellent.

### Recall

```
Recall = Known Issues Caught / Total Known Issues
```

**What it measures:** Of all known issues in the test app, how many did Dramaturge find?

**Note:** This is inherently limited because we only track *known* issues. The real value is in finding *unknown* issues, which aren't counted here.

### Time to First Finding

**What it measures:** How quickly does Dramaturge surface the first actionable issue?

**Why it matters:** Fast feedback loops are critical for CI/CD integration. If the first finding appears within 30-60 seconds, developers can act on it immediately.

### Finding Categories

We break down findings by type:

- **Bug** — functional issues, errors, broken workflows
- **Accessibility Issue** — WCAG violations, missing ARIA, keyboard nav
- **UX Concern** — confusing flows, missing feedback, inconsistent patterns
- **Performance Issue** — slow loads, layout shifts, bundle size
- **Visual Glitch** — layout breaks, styling issues, responsive failures

## Methodology

### 1. Configuration

Each app has a `benchmarks/configs/{app-id}.json` configuration:

- Target URL
- App description (context for the LLM)
- Budget constraints (max tasks, time limit)
- Agent modes (DOM vs CUA)
- Output directory

### 2. Execution

Run benchmarks with:

```bash
# Run all benchmarks
pnpm run benchmark

# Run specific app
pnpm run benchmark -- todomvc-react
```

### 3. Classification

After each run, findings are automatically classified:

- **True Positive**: Real issue (matches known issue or high-confidence novel finding)
- **False Positive**: Noise (expected behavior misclassified as issue)

Classification uses:
- Keyword matching against known issues
- Confidence scores from the agent
- Category alignment

For production benchmarks, manual review is recommended to validate classifications.

### 4. Reporting

Results are saved to `benchmarks/results/{app-id}/`:

- `metrics.json` — raw metrics data
- `metrics.md` — formatted summary
- `result.json` — full benchmark result with classifications

## Known Issues Database

Each benchmark app defines known issues in `src/benchmarks/apps.ts`:

```typescript
{
  id: 'todomvc-1',
  category: 'Accessibility Issue',
  description: 'Missing ARIA labels on todo item checkboxes',
  severity: 'Minor',
}
```

This allows us to track recall (how many known issues we catch) and validate findings against ground truth.

## False Positive Patterns

Common false positives we track:

1. **Expected API errors** — 401/403 on protected routes (already suppressed via policy)
2. **Console warnings** — framework debug messages, ResizeObserver (suppressed)
3. **Intentional UX patterns** — e.g., "no loading spinner" on instant operations
4. **Opinionated accessibility** — e.g., flagging color contrast that meets WCAG AA but not AAA

We continuously refine suppression rules based on FP patterns.

## How to Add a New Benchmark App

1. Add app definition to `src/benchmarks/apps.ts`
2. Create config file in `benchmarks/configs/{app-id}.json`
3. Document known issues (if any)
4. Run benchmark: `pnpm run benchmark -- {app-id}`
5. Review findings and update known issues database
6. Add results documentation to `docs/benchmarks/results/`

## Limitations

- **Manual review recommended** — automatic classification is heuristic-based
- **Known issues are incomplete** — we only track issues we've identified
- **Live demos change** — third-party sites may introduce or fix issues over time
- **Budget constraints** — benchmarks run with limited budgets; full exploration would find more

## Results

See individual result files in `benchmarks/results/` for detailed metrics from each run.

For a summary of current signal-to-noise performance, see the main [README.md](../../README.md#benchmark-results).
