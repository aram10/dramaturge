# Dramaturge

Dramaturge is an environment-aware exploratory QA harness for web applications.

It combines agentic browser exploration with deterministic scaffolding for auth, mission controls, policy suppression, evidence capture, and reproducible reporting. The goal is to help an operator drop into an unfamiliar environment, get oriented quickly, and come back with actionable findings instead of vague browser-agent output.

## What Dramaturge Does

- explores web apps with specialized `navigation`, `form`, and `crud` workers
- supports `none`, `form`, `oauth-redirect`, `stored-state`, and `interactive` auth
- accepts optional repo-aware hints so it can seed likely routes, selectors, and expected auth noise when source is available
- applies mission controls such as `criticalFlows`, `excludedAreas`, and destructive-action guardrails
- auto-captures console and network failures with policy-based suppression for expected environment noise
- runs deterministic accessibility scans alongside browser exploration
- optionally persists cross-run memory under `.dramaturge/` so later runs can reuse prior routes, suppressions, and auth hints
- can capture and compare visual baselines with deterministic `pixelmatch` diffs
- emits Markdown and JSON reports with evidence, confidence, and compact repro metadata

## Operating Modes

### Black-box mode

Point Dramaturge at a URL, configure auth, describe the app, and let it explore. This is the right mode when you do not have source access or want to treat the app as an external system.

### Repo-aware mode

Add `repoContext.root` and Dramaturge can mine source for route families, auth hints, stable selectors, and expected protected-route noise. Source-aware scanning is optional; the package does not require a sibling repo to run.

## Quick Start

### Run from this folder

Dramaturge is structured as a standalone package root. You can run it directly from this directory, copy it somewhere else, or extract it into its own repository.

```bash
pnpm install
pnpm build
pnpm exec dramaturge --config ./dramaturge.config.example.json
```

For a source run without compiling first:

```bash
pnpm install
pnpm exec tsx src/cli.ts --config ./dramaturge.config.example.json
```

### Pre-seed auth state with the bundled helper

If you want to reuse a logged-in browser session, create a storage-state file with the package-local helper:

```bash
pnpm exec dramaturge-auth-state \
  --url http://localhost:3000/login \
  --output ./.dramaturge-state/user.json \
  --success-url http://localhost:3000/
```

That command opens a visible Chromium browser, waits for you to finish sign-in, and writes the resulting state file inside the package directory you choose.

### Example profiles

- [`dramaturge.config.example.json`](./dramaturge.config.example.json)
  Generic starter config for a live or local app.
- [`examples/standalone.local.profile.jsonc`](./examples/standalone.local.profile.jsonc)
  Generic local profile with package-local state and reports.
- [`examples/standalone.live.profile.jsonc`](./examples/standalone.live.profile.jsonc)
  Generic live profile for deployed environments.
- [`examples/chatppt.local.profile.jsonc`](./examples/chatppt.local.profile.jsonc)
  ChatPPT-flavored profile that is still package-local by default. Additional host-repo integration is optional.

## Minimal Config

```jsonc
{
  "targetUrl": "https://your-app.example.com",
  "appDescription": "Internal app for managing users, content, and approvals.",
  "auth": {
    "type": "interactive",
    "loginUrl": "/login",
    "successIndicator": "selector:[data-testid='user-menu']",
    "stateFile": "./.dramaturge-state/user.json"
  },
  "models": {
    "planner": "anthropic/claude-sonnet-4-6",
    "worker": "anthropic/claude-haiku-4-5",
    "agentMode": "cua"
  },
  "output": {
    "dir": "./dramaturge-reports/default",
    "format": "both",
    "screenshots": true
  }
}
```

For a source-aware run, point `repoContext.root` at the app repo you want scanned:

```jsonc
"repoContext": {
  "root": "/absolute/path/to/your-app",
  "framework": "nextjs"
}
```

For cross-run memory and optional visual baselines:

```jsonc
"memory": {
  "enabled": true,
  "dir": "./.dramaturge",
  "warmStart": true
},
"visualRegression": {
  "enabled": true,
  "baselineDir": "./.dramaturge/visual-baselines",
  "diffPixelRatioThreshold": 0.01,
  "maskSelectors": []
}
```

`memory.enabled` keeps a package-local JSON store with prior finding signatures, suppressions, auth hints, and a navigation snapshot that can warm-start the next run. `visualRegression.enabled` captures a baseline on the first run and turns later diffs into normal findings with diff evidence.

## Deterministic Auth Patterns

`interactive` remains the safest default for local OAuth flows because it keeps the human in charge of the sensitive steps. When you do need automated auth, Dramaturge expects explicit selectors and values instead of model-mediated credential entry.

Form auth:

```jsonc
"auth": {
  "type": "form",
  "loginUrl": "/login",
  "fields": [
    { "selector": "input[name='email']", "value": "${TEST_USER_EMAIL}" },
    { "selector": "input[name='password']", "value": "${TEST_USER_PASSWORD}", "secret": true }
  ],
  "submit": { "selector": "button[type='submit']" },
  "successIndicator": "selector:[data-testid='user-menu']"
}
```

Redirect auth:

```jsonc
"auth": {
  "type": "oauth-redirect",
  "loginUrl": "/login",
  "steps": [
    { "type": "click", "selector": "button[data-provider='microsoft']" },
    { "type": "fill", "selector": "input[type='email']", "value": "${TEST_USER_EMAIL}" },
    { "type": "click", "selector": "input[type='submit']" },
    { "type": "wait-for-selector", "selector": "input[type='password']" },
    { "type": "fill", "selector": "input[type='password']", "value": "${TEST_USER_PASSWORD}", "secret": true },
    { "type": "click", "selector": "input[type='submit']" }
  ],
  "successIndicator": "selector:[data-testid='user-menu']"
}
```

## Operator Playbook

### 1. Pick the safest auth strategy first

| Auth type | Best for | Operator guidance |
|---|---|---|
| `interactive` | local OAuth or flaky sign-in flows | Best default for protected apps. Reuses cached state when possible and falls back to manual login. |
| `stored-state` | stable reused sessions | Best when you already have a good storage-state file and want the most repeatable auth path. |
| `form` | simple single-page logins | Use only when the app really has a straightforward username/password form and you can provide stable selectors for every field plus the submit action. |
| `oauth-redirect` | multi-step IdP flows | Useful when you can script each redirect step with explicit selectors. Prefer `interactive` or `stored-state` when the IdP is sensitive to automation. |
| `none` | public apps | No authentication. |

### 2. Give the agent a mission, not just a URL

The most useful knobs are:

- `criticalFlows`
  Boost the flows that matter most.
- `excludedAreas`
  Skip pages or route families you do not want explored.
- `destructiveActionsAllowed`
  Keep this `false` unless you explicitly want destructive exploration.
- `focusModes`
  Restrict the run to `navigation`, `form`, and/or `crud` when you want a narrower sweep.

### 3. Teach the harness what noise is expected

If the app intentionally returns protected-route `401` or `403` responses before login, add them to `policy.expectedResponses`. If the environment emits known harmless console chatter, add patterns to `policy.ignoredConsolePatterns`.

### 4. Run Dramaturge and watch the first mile

The first things to confirm are:

- auth succeeds with the configured `successIndicator`
- the agent lands in the right route family after login
- no obvious expected-noise findings dominate the first report
- the frontier is discovering meaningful pages instead of looping near the entry point

## Authentication Indicators

Dramaturge supports four success-indicator formats:

- `url:/dashboard`
  Exact path match. This is the safest URL-based option.
- `url-prefix:/manage`
  Prefix path match. Use this only when successful auth intentionally lands in multiple sub-routes.
- `selector:[data-testid='user-menu']`
  DOM-based match for an element that only appears after sign-in.
- `text:Welcome back`
  Text-based match when the post-login UI has stable visible copy.

Avoid `url:/` as a generic auth check. It is usually too broad for modern apps because login pages, callback routes, and other unauthenticated pages often also live under `/`.

## Reports

Each finding can carry:

- `source`
  `agent`, `auto-capture`, or `confirmed`
- `confidence`
  `low`, `medium`, or `high`
- `repro`
  route or state, objective, breadcrumbs, and linked evidence ids

A typical run directory looks like this:

```text
dramaturge-reports/
  2026-03-27T10-40-19/
    report.md
    report.json
    screenshots/
```

The most important report concepts for operators are:

- `Confidence`
  How strongly the harness believes the finding is real.
- `Repro`
  The route, objective, breadcrumbs, and evidence ids needed to replay it.
- `Blind Spots`
  Areas the run could not cover because of time, policy, or state reachability limits. Blind spots are not bugs, but they do tell you where confidence is lower.
- `Run Memory`
  A summary of how much history the run reused, how many findings are being tracked across runs, and whether warm start was applied.

## Standalone Verification

From inside this folder, you can prove that the packed artifact installs and runs outside the host repo:

```bash
pnpm build
pnpm test
pnpm run verify:standalone
```

That smoke test packs the package, installs it into a temp directory outside this repo, runs `dramaturge --help`, loads the packaged standalone example, and scans the installed docs/examples for forbidden host-repo references.

## ChatPPT Notes

The ChatPPT-specific runbook lives in [`docs/chatppt-smoke.md`](./docs/chatppt-smoke.md). The packaged ChatPPT profile stays self-contained by default, and source-aware scanning only happens if you point `repoContext.root` at a ChatPPT checkout on purpose.

## Publishing To GitHub Packages

This package is now scoped for your GitHub Packages namespace as `@aram10/dramaturge`.

1. Keep `publishConfig.registry` pointing at `https://npm.pkg.github.com`.
2. Add a local `.npmrc` with `@aram10:registry=https://npm.pkg.github.com` when publishing or installing from GitHub Packages.
3. The package metadata already points at `https://github.com/aram10/dramaturge`.
4. Run `pnpm pack` and `pnpm run verify:standalone`.
5. If this folder has become the repo root, the bundled workflow at [`./.github/workflows/publish.yml`](./.github/workflows/publish.yml) is ready to publish it.

## What Dramaturge Is Not

- not a replacement for deterministic Playwright suites
- not a CI gate you should trust blindly
- not a generic browser agent with no harness around it

The value is the combination of autonomy and structure: the agent can figure things out, but it does so inside a harness that gives it context, guardrails, and a reporting shape humans can act on.
