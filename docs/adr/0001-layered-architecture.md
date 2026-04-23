# ADR 0001: Adopt explicit layered architecture boundaries

- Status: Accepted
- Date: 2026-04-23

## Context

Dramaturge grew quickly around a strong product idea, but the runtime began to blur configuration, orchestration, reporting, and presentation concerns. That made it easy to keep shipping features while making it harder to reason about ownership and safe dependency direction.

## Decision

We define explicit architectural layers and document allowed dependency flow:

- CLI
- Configuration
- Orchestration
- Domain/shared contracts
- Adapters/integrations
- Reporting/presentation

We also add an automated architectural test to prevent the highest-risk boundary violations.

## Consequences

### Positive

- Engine refactors can happen behind clearer seams.
- Configuration stays usable outside the full runtime.
- Reporting remains reusable from CI and library integrations.
- New contributors get a simpler mental model.

### Negative

- Some cross-layer imports that were previously convenient now require deliberate wrapper modules.
- Architectural tests add maintenance overhead when files move.

## Follow-up

- Split `src/config.ts` into feature modules.
- Split `src/types.ts` by bounded context.
- Reduce the public surface of `src/index.ts` to explicitly supported APIs.
