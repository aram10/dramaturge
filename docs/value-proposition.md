# Dramaturge Value Proposition

## Core Statement

Dramaturge is an environment-aware exploratory QA harness that can boot into an unfamiliar application, learn from its runtime and optionally its source tree, explore with controlled autonomy, and return reproducible findings instead of vague browser-agent output.

This is the category distinction that matters:

- Dramaturge is not just "an AI that clicks around websites."
- Dramaturge is not trying to replace authored regression suites.
- Dramaturge is the layer that gets oriented quickly in messy environments and hands humans actionable next steps.

## The Problem We Are Solving

Most browser agents are powerful but under-supported. They can reason, click, and navigate, but they often start cold:

- They do not know which routes matter.
- They do not know which 401s or 403s are normal.
- They do not know how auth works in this codebase.
- They do not leave behind a clean reproduction story.

Most test automation products solve a different problem:

- Authoring or maintaining regression coverage
- Managed end-to-end execution
- Natural-language test creation

Dramaturge sits between those categories. It is the harness for fast orientation, exploratory coverage, and first-pass defect discovery in unfamiliar environments.

## Pillars

### Environment-aware bootstrap

Dramaturge can start from a URL-only configuration, but it gets stronger when it can also consume environment hints:

- optional local bootstrap command
- repo-aware route and selector extraction
- auth route detection
- expected protected-route noise suppression

The key promise is reduced "fish out of water" behavior.

### Controlled autonomy

The agent decides what to probe and how to investigate, but the surrounding system stays deterministic where it matters:

- mission controls
- state identity and restoration
- policy-based false-positive suppression
- bounded concurrency, checkpoints, and budgets

Autonomy is useful only when the harness keeps it legible and safe.

### Codebase-aware hints when source is available

Dramaturge can use source access without becoming tightly coupled to one app:

- stable selectors
- route families
- auth hints
- query-driven state examples

This keeps the product portable while still rewarding environments where source is available.

### Reproducible exploratory findings

A finding should be more than a paragraph plus a screenshot. Dramaturge findings now include:

- source attribution
- confidence
- evidence ids
- a compact repro artifact with route, objective, and breadcrumbs

That makes the output easier to triage, replay, and convert into deterministic follow-up tests.

## Comparison

| Product | Center of gravity | Where Dramaturge differs |
|---|---|---|
| Stagehand | Browser automation substrate for `observe`, `act`, and `agent` primitives | Dramaturge is a QA harness built on top of this kind of substrate, with policy, mission controls, repo hints, and reporting |
| browser-use | General-purpose browser agent runtime | Dramaturge is narrower and more opinionated around exploratory QA, auth, evidence, and reproducible findings |
| Skyvern | Workflow-oriented browser automation and orchestration | Dramaturge focuses on exploratory investigation in unfamiliar environments rather than business-process automation |
| QA Wolf | Managed end-to-end automation and coverage operations | Dramaturge is not a managed regression program; it is the fast-orientation layer before or alongside authored suites |
| Momentic | AI-assisted end-to-end test authoring and maintenance | Dramaturge emphasizes exploration and bug discovery before the team has a durable authored test |
| mabl | Low-code regression testing and test maintenance | Dramaturge is intentionally lighter on scripted regression ownership and stronger on autonomous first-pass exploration |
| Autify | AI and no-code UI test automation | Dramaturge focuses on investigation and repro artifacts instead of polished no-code suite authoring |
| KaneAI | Natural-language testing on cloud execution infrastructure | Dramaturge differentiates through repo-aware hints, mission policy, and environment bootstrapping for unfamiliar apps |

## What Makes Dramaturge Stand Out

Dramaturge should win on the combination of these traits, not on any one of them in isolation:

1. It can start in black-box mode and still be useful.
2. It gets meaningfully better when source is available.
3. It keeps agent behavior inside a deterministic harness.
4. It produces findings that humans can replay and trust.

That combination is a stronger product story than "AI testing," which is already crowded and underspecified.

## Non-Goals

- Replacing deterministic Playwright coverage
- Promising zero-config perfection in every environment
- Acting as a generic browser automation platform

Dramaturge is strongest when positioned as the exploratory front end to a broader testing strategy.
