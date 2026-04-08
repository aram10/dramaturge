# Copilot Instructions — Dramaturge

## Project Overview

Dramaturge is an agentic exploratory QA engine for web applications built with TypeScript, Playwright, and Stagehand. It autonomously explores, tests, and reports findings on live web apps using LLM-driven browser agents.

## Tech Stack

- Language: TypeScript 5.8+ (strict mode, ES2022 target)
- Runtime: Node.js ≥ 20, ES modules
- Package manager: pnpm 9 (activate with `corepack enable`)
- Browser automation: Playwright + Stagehand
- Validation: Zod 4 (config), AJV 8 (JSON Schema / OpenAPI)
- Terminal UI: Ink 5 + React 18 (`.tsx` files)
- Testing: Vitest 4
- Linting: ESLint 10 (flat config, typescript-eslint) + Prettier

## Build & Test

```
corepack enable && pnpm install --frozen-lockfile
pnpm run build         # TypeScript → dist/
pnpm run test          # Vitest (600+ tests)
pnpm run lint          # ESLint
pnpm run format:check  # Prettier
```

## Coding Conventions

These rules apply to Dramaturge source code and tests. Files under `src/adaptation/fixtures/**` are framework sample apps that intentionally use framework-native conventions (default exports, extensionless imports) — do not refactor those.

- **Named exports only** — never use default exports (outside `src/adaptation/fixtures/**`)
- All relative imports must use `.js` extension (outside fixtures): `import { Foo } from './foo.js'`
- Use `import type { X }` for type-only imports
- Semicolons always, single quotes, 2-space indent, 100-char print width
- Trailing commas in ES5 positions
- `const` by default; `no-var` enforced; avoid `any` (use `unknown` + narrowing)
- Use Zod schemas for config validation
- Use discriminated unions for polymorphic types
- Prefer options objects over long parameter lists (max 5 params per ESLint rule)
- Functions should stay under 150 lines; cyclomatic complexity under 20; max nesting depth 4

## Testing Standards

- Co-located tests: `foo.test.ts` beside `foo.ts`
- Use `vi.hoisted()` for mock factories to avoid hoisting issues
- Use `vi.mock('./path.js', () => ({ ... }))` with `.js` extension
- Use `vi.mocked()` for type-safe assertions on mocks
- Factory helpers: `function makeItem(overrides?: Partial<T>): T`
- Always `vi.clearAllMocks()` in `beforeEach`
- Never remove or weaken existing tests

## Architecture

- Entry point: `src/engine.ts` → `runEngine()`
- Engine loop: Planner → Frontier Queue → Workers → Graph Expansion → Repeat
- Workers are Stagehand agents with typed tools (log_finding, take_screenshot, etc.)
- Five worker types: navigation, form, crud, api, adversarial
- A2A protocol for multi-agent coordination (Coordinator, Blackboard, MessageBus)

## Error Handling

- Permissive — catch errors, log structured findings, don't crash the engine
- Workers return outcome: `completed | blocked | timed-out | failed`
- Policy layer suppresses expected noise (ResizeObserver, known 401s)

## Commit Messages

Follow Conventional Commits: `feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`, `perf:`, `ci:`

Append `!` for breaking changes. Do not edit CHANGELOG.md.

## What to Avoid

- Default exports (in Dramaturge source — `src/adaptation/fixtures/**` is exempt)
- The `any` type
- Missing `.js` in relative import paths (fixtures exempt)
- `console.log` for debugging (use structured evidence/findings)
- Editing `CHANGELOG.md`, `dist/`, or `pnpm-lock.yaml` directly
- Removing or disabling existing tests
- Functions exceeding 150 lines or complexity 20
