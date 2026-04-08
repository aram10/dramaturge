---
applyTo: "**/*.ts,**/*.tsx"
---

# TypeScript Conventions — Dramaturge

## Module System
- ES modules with `.js` extension in all relative imports (TypeScript compiles to ESM)
- Use `import type { X }` for type-only imports — never mix value and type imports
- Named exports only; no default exports

## Type Safety
- Strict mode enabled; honor it — no `@ts-ignore` or `@ts-expect-error` without justification
- Never use `any`; prefer `unknown` with type narrowing or define proper interfaces
- Use discriminated unions for variant types (see `AuthSchema` in `src/config.ts`)
- Use Zod schemas for runtime validation of external data (config files, LLM responses)

## Patterns
- Options objects for functions with 3+ parameters (see `WorkerToolOptions` in `src/worker/tools.ts`)
- `const` by default; `let` only when reassignment is necessary
- Prefer `Array.map`/`filter`/`reduce` over mutation loops
- Arrow functions for inline callbacks; `function` declarations for top-level named functions
- JSX uses `react-jsx` transform (no React import needed in `.tsx` files)

## ESLint Guardrails
- `max-params: 5` — refactor to options object if exceeded
- `max-lines-per-function: 150` — split large functions into helpers
- `complexity: 20` — extract branches into separate functions
- `max-depth: 4` — flatten with early returns or guard clauses

## Error Handling
- Wrap async operations in try/catch; return structured outcomes, don't throw
- Workers use outcome types: `'completed' | 'blocked' | 'timed-out' | 'failed'`
- Browser operations may silently fail; always handle `catch { /* best-effort */ }`
