# WebProbe

WebProbe is an environment-aware exploratory QA harness for web applications.

It combines agentic browser exploration with deterministic scaffolding for auth, repo-aware hints, mission controls, policy suppression, evidence capture, and reproducible reporting. The point is not to replace a polished regression suite. The point is to help an operator drop into an unfamiliar environment, get oriented quickly, and come back with actionable findings instead of vague browser-agent output.

## Why WebProbe Exists

Traditional Playwright or Cypress suites are strongest when the team already knows the product, the happy paths are well defined, and the assertions are intentional.

WebProbe is for the earlier and messier part of the lifecycle:

- a new environment needs a quick read
- the app has weak or incomplete automated coverage
- the agent needs help understanding routes, auth, and what "normal" looks like
- humans need findings they can replay, not just a transcript of clicks

## What WebProbe Does Today

- explores web apps with specialized `navigation`, `form`, and `crud` workers
- supports `none`, `form`, `oauth-redirect`, `stored-state`, and `interactive` auth
- accepts repo-aware hints so it can seed likely routes, stable selectors, and expected auth noise from source
- applies mission controls such as `criticalFlows`, `excludedAreas`, and destructive-action guardrails
- auto-captures console and network failures with policy-based suppression for expected environment noise
- emits Markdown and JSON reports with evidence, confidence, and a compact repro artifact per finding

## How WebProbe Stays Grounded

WebProbe is intentionally not "just an AI that clicks around."

The surrounding harness keeps the run legible:

- deterministic navigation and state restoration around agent work
- query-aware state identity so meaningful route variants do not collapse together
- per-page browser error attribution instead of one shared noise bucket
- repo-aware route, selector, and auth hints when source is available
- policy suppression for expected 401 or 403 noise and known console chatter
- mission steering so critical flows are boosted and excluded areas are skipped
- finding metadata with source, confidence, route, breadcrumbs, and evidence ids

## Operating Modes

### Black-box mode

Point WebProbe at a URL, configure auth, describe the app, and let it explore. This is the right mode when you do not have source access or want to treat the app as an external system.

### Repo-aware mode

Add `repoContext.root` and WebProbe can mine source for route families, auth hints, stable selectors, and expected protected-route noise. The agent still explores autonomously, but it starts with better orientation and fewer false positives.

## Quick Start

WebProbe currently runs from this repo rather than as a published package.

1. Install dependencies.
2. Copy and adapt [`webprobe.config.example.json`](./webprobe.config.example.json) or start from [`examples/chatppt.local.profile.jsonc`](./examples/chatppt.local.profile.jsonc).
3. Export an LLM provider key such as `ANTHROPIC_API_KEY` or `OPENAI_API_KEY`.
4. Run WebProbe from the `webprobe/` directory.

```bash
pnpm install
cd webprobe
npx tsx src/index.ts --config webprobe.config.example.json
```

If you prefer a compiled run:

```bash
pnpm build
node dist/index.js --config webprobe.config.example.json
```

## Minimal Config

```jsonc
{
  "targetUrl": "https://your-app.example.com",
  "appDescription": "Internal app for managing users, content, and approvals.",
  "auth": {
    "type": "interactive",
    "loginUrl": "/login",
    "successIndicator": "selector:[data-testid='user-nav-button']",
    "stateFile": ".webprobe-state.json"
  },
  "models": {
    "planner": "anthropic/claude-sonnet-4-6",
    "worker": "anthropic/claude-haiku-4-5",
    "agentMode": "cua"
  },
  "output": {
    "dir": "./webprobe-reports",
    "format": "both",
    "screenshots": true
  }
}
```

For a source-aware run, add:

```jsonc
"repoContext": {
  "root": "..",
  "framework": "nextjs"
}
```

## Operator Playbook

### 1. Pick the safest auth strategy first

| Auth type | Best for | Operator guidance |
|---|---|---|
| `interactive` | local OAuth or flaky sign-in flows | Best default for local protected apps. Reuses cached state when possible and falls back to manual login. |
| `stored-state` | stable reused sessions | Best when you already have a good storage-state file and want the most repeatable auth path. |
| `form` | simple single-page logins | Use only when the app really has a straightforward username/password form. |
| `oauth-redirect` | multi-step IdP flows | Useful, but inherently best-effort. Prefer `interactive` or `stored-state` when the IdP is sensitive to automation. |
| `none` | public apps | No authentication. |

For OAuth-heavy local environments, `interactive` is usually the right answer.

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

This is one of the biggest levers for keeping WebProbe from struggling in a new codebase.

### 4. Run WebProbe and watch the first mile

The first things to confirm are:

- auth succeeds with the configured `successIndicator`
- the agent lands in the right route family after login
- no obvious expected-noise findings dominate the first report
- the frontier is discovering meaningful pages instead of looping near the entry point

## Authentication Indicators

WebProbe supports four success-indicator formats:

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

Each finding can now carry:

- `source`
  `agent`, `auto-capture`, or `confirmed`
- `confidence`
  `low`, `medium`, or `high`
- `repro`
  route or state, objective, breadcrumbs, and linked evidence ids

A typical run directory looks like this:

```text
webprobe-reports/
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

## ChatPPT Local Recipe

WebProbe ships with a concrete ChatPPT profile at [`examples/chatppt.local.profile.jsonc`](./examples/chatppt.local.profile.jsonc).

From the repo root:

```powershell
pnpm local:up -- --backend-ref main
```

Optional: pre-seed auth state so WebProbe can reuse it immediately:

```powershell
npx tsx tests/interactive-login.ts
```

Then run WebProbe from `webprobe/`:

```powershell
npx tsx src/index.ts --config examples/chatppt.local.profile.jsonc
```

What that profile does:

- targets `http://localhost:3000`
- uses `interactive` auth with cached state reuse
- uses `selector:[data-testid='user-nav-button']` as the post-login signal
- turns on repo-aware Next.js hints from the parent repo
- suppresses expected protected-route noise for common ChatPPT API families
- prioritizes the chat shell, knowledge bases, and `/manage/knowledge-bases`
- keeps destructive actions disabled

## What WebProbe Is Not

- not a replacement for deterministic Playwright suites
- not a CI gate you should trust blindly
- not a generic browser agent with no harness around it

The value is the combination of autonomy and structure: the agent can figure things out, but it does so inside a harness that gives it context, guardrails, and a reporting shape humans can act on.
