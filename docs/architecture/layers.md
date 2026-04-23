# Architecture Layers

Dramaturge is now organized around explicit architectural layers.

## Layers

1. **CLI**
   - `src/cli.ts`
   - `src/bin/**`
   - `src/commands/**`
   - `src/action/**`
2. **Configuration**
   - `src/config*.ts`
   - `src/env.ts`
3. **Orchestration**
   - `src/engine.ts`
   - `src/engine/**`
   - `src/planner/**`
   - `src/graph/**`
   - `src/worker/**`
   - `src/checkpoint.ts`
   - `src/browser-errors.ts`
4. **Domain and shared contracts**
   - `src/types.ts`
   - `src/constants.ts`
   - `src/redaction.ts`
   - `src/prompt-safety.ts`
5. **Adapters and integrations**
   - `src/auth/**`
   - `src/api/**`
   - `src/spec/**`
   - `src/network/**`
   - `src/llm/**`
   - `src/llm.ts`
   - `src/browser/**`
   - `src/adaptation/**`
   - `src/a2a/**`
   - `src/memory/**`
   - `src/coverage/**`
   - `src/policy/**`
   - `src/repro/**`
   - `src/judge/**`
6. **Reporting and presentation**
   - `src/report/**`
   - `src/dashboard/**`

## Dependency expectations

- CLI may depend on every lower layer.
- Configuration must stay independent of orchestration and presentation.
- Orchestration may depend on configuration, domain, adapters, and reporting.
- Reporting must not depend on CLI entrypoints.
- Dashboard remains presentation-only and should not become a dependency of engine runtime code.

## Stability tiers

- **Stable:** `runEngine`, config loading, report renderers, repo scanning, public types needed for integrations.
- **Experimental:** A2A coordination, advanced adversarial probes, generated Playwright test output details, vision analysis behavior.

Experimental surfaces should stay clearly documented and easy to isolate behind configuration flags.
