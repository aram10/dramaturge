# WebProbe

WebProbe is an environment-aware exploratory QA harness for web applications.

It combines agentic browser exploration with deterministic scaffolding for auth, repo-aware hints, policy controls, evidence capture, and reproducible reporting. The goal is not to replace a polished regression suite. The goal is to help a tester or engineer drop into an unfamiliar environment, get oriented quickly, and come back with actionable findings instead of vague agent output.

## Why WebProbe Exists

Traditional Playwright or Cypress suites are strongest when the team already knows the product, the happy paths are well defined, and the assertions are intentional.

WebProbe is for the earlier and messier part of the lifecycle:

- A new environment needs a quick read.
- The app has weak or incomplete automated coverage.
- The agent needs help understanding routes, auth, and what "normal" looks like.
- Humans need findings they can replay, not just a transcript of clicks.

## What WebProbe Does Today

- Explores web apps with specialized `navigation`, `form`, and `crud` workers
- Supports `none`, `form`, `oauth-redirect`, `stored-state`, and `interactive` auth
- Accepts repo-aware hints so it can seed likely routes, stable selectors, and expected auth noise from source
- Applies mission controls such as `criticalFlows`, `excludedAreas`, and destructive-action guardrails
- Auto-captures console and network failures with policy-based suppression for expected environment noise
- Emits Markdown and JSON reports with evidence, confidence, and a compact repro artifact per finding

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

For OAuth-heavy local environments, `interactive` auth is often the most reliable default because it can reuse a cached browser state and fall back to manual sign-in when needed.

## Reports

Each finding can now carry:

- `source`
  `agent`, `auto-capture`, or `confirmed`
- `confidence`
  `low`, `medium`, or `high`
- `repro`
  Route or state, objective, breadcrumbs, and linked evidence ids

This keeps WebProbe findings closer to a lightweight bug report than a raw agent transcript.

## What WebProbe Is Not

- Not a replacement for deterministic Playwright suites
- Not a CI gate you should trust blindly
- Not a generic browser agent with no harness around it

The value is the combination of autonomy and structure: the agent can figure things out, but it does so inside a harness that gives it context, guardrails, and a reporting shape humans can act on.

## ChatPPT Example

- Local profile: [`examples/chatppt.local.profile.jsonc`](./examples/chatppt.local.profile.jsonc)
- Smoke runbook: [`docs/chatppt-smoke.md`](./docs/chatppt-smoke.md)
- Positioning note: [`docs/value-proposition.md`](./docs/value-proposition.md)
