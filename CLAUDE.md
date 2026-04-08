# CLAUDE.md — Dramaturge

Dramaturge is an **agentic exploratory QA engine** for web applications. It uses LLM-driven browser agents (via Stagehand/Playwright) to autonomously explore, test, and report findings on live web apps — including form flows, CRUD operations, API contracts, accessibility, visual regressions, and adversarial security probes.

## Tech Stack

- **Language**: TypeScript 5.8+ (strict mode, ES2022 target, Node16 module resolution)
- **Runtime**: Node.js ≥ 20, ES modules (`"type": "module"`)
- **Package manager**: pnpm 9 (use `corepack enable` first)
- **Browser automation**: Playwright + Stagehand (agentic wrapper)
- **Schema validation**: Zod 4 (config), AJV 8 (OpenAPI/JSON Schema)
- **UI**: Ink 5 + React 18 (terminal dashboard via JSX — `.tsx` files)
- **Testing**: Vitest 4 (co-located `*.test.ts` files)
- **Linting**: ESLint 10 (flat config) + typescript-eslint + Prettier
- **CI/CD**: GitHub Actions, release-please for versioning, GitHub Packages for publishing

## Commands

```bash
corepack enable            # activate pnpm (required once)
pnpm install               # install dependencies
pnpm run build             # clean + tsc → dist/
pnpm run test              # vitest run (all 600+ tests)
pnpm run lint              # eslint .
pnpm run lint:fix          # eslint . --fix
pnpm run format            # prettier --write .
pnpm run format:check      # prettier --check .
pnpm run verify:standalone # smoke-check the packed tarball
```

Run a single test file: `pnpm run test -- --run src/config.test.ts`

## Project Structure

```
src/
├── a2a/          # Multi-agent orchestration (Agent-to-Agent protocol)
├── action/       # GitHub Action helper scripts
├── adaptation/   # Framework detection & repo scanning (Next.js, Django, Rails, etc.)
├── adversarial/  # Security & edge-case testing (OWASP, injection, race conditions)
├── api/          # API contract probing, replay, assertions
├── auth/         # Authentication strategies (form, oauth-redirect, interactive, stored-state)
├── bin/          # CLI entry points (export-auth-state)
├── browser/      # Stagehand page wrapper/adapter
├── coverage/     # Quality metrics (accessibility, cost, visual regression, web vitals)
├── dashboard/    # Ink/React terminal UI (real-time dashboard)
├── diff/         # Diff-aware exploration (scope changes to affected routes)
├── engine/       # Core orchestration loop (bootstrap, graph ops, worker pool, events)
├── evals/        # Evaluation framework (fixtures, harness)
├── graph/        # State graph (nodes, edges, frontier priority queue, fingerprinting)
├── judge/        # Finding validation & reasoning (LLM + deterministic graders)
├── memory/       # Cross-run memory (warm start, finding history, flaky page tracking)
├── network/      # API traffic observation
├── planner/      # Task planning, navigation, page classification, priority scoring
├── policy/       # Suppression rules & safety guards
├── report/       # Report generation (Markdown, JSON, Playwright test generation)
├── repro/        # Finding reproduction
├── spec/         # OpenAPI spec handling (loading, building, contract indexing)
├── utils/        # Shared utilities (JSONC parsing)
├── worker/       # Worker execution (prompts, tools, action recording, stagnation detection)
├── cli.ts        # CLI entry point
├── config.ts     # Configuration loading & Zod validation
├── constants.ts  # Global constants (truncation limits, timeouts, retry caps)
├── engine.ts     # Main runEngine() entry point
├── index.ts      # Public API barrel exports
├── llm.ts        # Multi-provider LLM abstraction (Anthropic, OpenAI, Google)
├── redaction.ts  # Sensitive data redaction
└── types.ts      # Core type definitions (Finding, Evidence, WorkerTask, StateNode, etc.)
```

## Architecture

**Engine loop**: frontier-based exploration — Planner generates tasks from state graph nodes → workers execute via Stagehand agent with typed tools → graph expands with discovered edges → repeat until budget exhausted.

**Worker types**: `navigation`, `form`, `crud`, `api`, `adversarial` — each specializes in different testing strategies.

**Agent modes**: `cua` (computer-use agent, sees viewport) or `dom` (DOM tree inspection).

**A2A protocol**: Optional multi-agent coordination with Coordinator, Blackboard (shared state), MessageBus (inter-agent messaging), and five agent roles (Scout, Tester, Security, Reviewer, Reporter).

## Code Conventions

These conventions apply to Dramaturge runtime/library code and tests. Files under `src/adaptation/fixtures/**` are framework sample apps that intentionally use framework-native patterns (default exports, aliased imports, extensionless imports) — do not "fix" those.

- **Named exports only** — no default exports (outside fixtures)
- **ES module imports with `.js` extension** (outside fixtures): `import { X } from './module.js'`
- **`import type`** for type-only imports: `import type { Config } from './config.js'`
- **Barrel files**: `src/index.ts` (public API), `src/a2a/index.ts`
- **No path aliases** (outside fixtures) — all imports are relative
- **Discriminated unions** for polymorphic types (auth strategies, worker types, frontier status)
- **Zod schemas** for all configuration validation
- **Options objects** for functions with >2-3 parameters (e.g., `WorkerToolOptions`)
- **Functional style preferred**: pure functions, minimal mutation, `const` by default

## Formatting (Prettier)

- Semicolons: always
- Quotes: single
- Trailing commas: ES5 (`trailingComma: 'es5'`)
- Print width: 100
- Indent: 2 spaces
- Arrow parens: always
- Line endings: LF

## Testing Patterns

- Co-located test files: `module.test.ts` next to `module.ts`
- **Hoisted mocks** for circular deps: `const mocks = vi.hoisted(() => ({ fn: vi.fn() }))`
- **`vi.mock()`** with `.js` extension paths: `vi.mock('./module.js', () => ({ ... }))`
- **`vi.mocked()`** for type-safe mock access
- **Factory helpers** for test doubles: `function makeItem(overrides = {}): FrontierItem`
- `describe()` / `it()` blocks with clear descriptive names
- `beforeEach(() => vi.clearAllMocks())`
- Cleanup temp files in `afterEach`

## Error Handling

- **Permissive** — errors are caught and logged, not thrown to crash the engine
- Browser errors auto-captured via `BrowserErrorCollector`
- Policy layer suppresses known-noisy patterns (ResizeObserver, expected 401s)
- Workers return outcome status: `completed | blocked | timed-out | failed`
- Findings carry confidence levels: `low | medium | high`

## Import Order

1. Node.js built-ins: `import { readFileSync } from 'node:fs'`
2. Third-party packages: `import { z } from 'zod'`
3. Local relative imports: `import { StateGraph } from './graph/state-graph.js'`
4. Type-only imports last: `import type { Finding } from './types.js'`

## Commit Convention

**Conventional Commits** (drives release-please):
- `feat:` → minor bump
- `fix:` → patch bump
- `feat!:` / `BREAKING CHANGE:` → major bump
- `docs:`, `chore:`, `refactor:`, `test:`, `perf:`, `ci:` → no bump

Do not edit `CHANGELOG.md` — it is auto-generated.

## Pitfalls

- Never use default exports in Dramaturge source (fixtures under `src/adaptation/fixtures/**` are exempt)
- Never use `any` — use `unknown` and narrow, or define proper types
- Always use `.js` extension in relative imports outside fixtures (TypeScript compiles to ESM)
- Do not add `console.log` for debugging — the codebase uses structured evidence/findings
- Config files support JSONC (comments allowed) — use `parseJsoncObject()` from `src/utils/jsonc.js`
- Stagehand operations are async and may timeout — always handle failures gracefully
- The `engine.ts` `runEngine()` function is the main entry point — do not bypass the engine loop
- Tests must pass with `pnpm run test` — never remove or disable existing tests
- Lint must pass with `pnpm run lint` — fix warnings, don't suppress them
