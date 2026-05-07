# Dramaturge

[![CI](https://github.com/aram10/dramaturge/actions/workflows/ci.yml/badge.svg)](https://github.com/aram10/dramaturge/actions/workflows/ci.yml)
[![Lint](https://github.com/aram10/dramaturge/actions/workflows/lint.yml/badge.svg)](https://github.com/aram10/dramaturge/actions/workflows/lint.yml)
[![Coverage](https://codecov.io/gh/aram10/dramaturge/branch/main/graph/badge.svg)](https://codecov.io/gh/aram10/dramaturge)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org)

**Autonomous QA testing for web applications.** Point Dramaturge at your app and it will explore, test, and report issues—no test scripts required.

## Quick Start

Install:

```bash
npm install dramaturge
npx playwright install chromium
```

Generate config:

```bash
npx dramaturge auto-config
```

Set your API key:

```bash
export ANTHROPIC_API_KEY="your-key-here"
```

Run:

```bash
npx dramaturge --config dramaturge.config.json
```

That's it! Dramaturge will explore your app and generate a report with any issues it finds.

## What It Does

Dramaturge uses AI-powered browser agents to test your web application automatically. It:

- **Explores your app** — clicks links, fills forms, tests workflows
- **Finds bugs** — catches console errors, broken pages, validation issues
- **Checks accessibility** — runs axe-core tests on every page
- **Tests APIs** — validates contracts and auth boundaries
- **Provides evidence** — every finding includes screenshots and reproduction steps

No test scripts. No brittle selectors. Just point it at your app and run.

## Why Use Dramaturge?

**For exploratory testing:**
- Test legacy apps without documentation
- Find edge cases you didn't think to test
- Get coverage without writing test suites

**For CI/CD:**
- Catch regressions before deployment
- Validate PRs automatically
- Track issues across releases

**For security & compliance:**
- Find vulnerabilities (OWASP scenarios)
- Audit accessibility (WCAG)
- Validate API contracts

## How It Works

1. **Start exploring** — Dramaturge navigates to your app's entry point
2. **Discover pages** — AI agents click links and fill forms to map your app
3. **Test as it goes** — Each page is checked for errors, accessibility issues, and more
4. **Generate report** — Get a detailed report with screenshots and reproduction steps

All powered by LLM-driven browser agents that adapt to your UI naturally.

## Authentication

Dramaturge supports multiple auth strategies:

**Interactive (easiest)** — Manually log in once, Dramaturge saves the session:
```json
{
  "auth": {
    "type": "interactive",
    "loginUrl": "/login",
    "successIndicator": "selector:[data-testid='user-menu']"
  }
}
```

**Form auth** — Provide credentials and selectors:
```json
{
  "auth": {
    "type": "form",
    "loginUrl": "/login",
    "fields": [
      { "selector": "input[name='email']", "value": "${TEST_USER_EMAIL}" },
      { "selector": "input[name='password']", "value": "${TEST_USER_PASSWORD}", "secret": true }
    ],
    "submit": { "selector": "button[type='submit']" },
    "successIndicator": "selector:[data-testid='dashboard']"
  }
}
```

**OAuth, stored state, or public pages** — See [full authentication guide](#authentication-guide) below.

## Capturing Authentication State

The easiest way to capture auth state is via the setup wizard:

```bash
pnpm exec dramaturge setup
```

The wizard can open a browser for manual sign-in, save the resulting storage state to `.dramaturge-state/<profile>.json`, and update your generated config to use `stored-state` auth.

To capture auth state later (outside the wizard):

```bash
# Read login URL from dramaturge.config.json (default)
pnpm exec dramaturge auth capture --profile user

# Use a different config file
pnpm exec dramaturge auth capture --config /path/to/dramaturge.config.json --profile admin

# Specify the login URL directly (no config required)
pnpm exec dramaturge auth capture --url https://my-app.example.com/login --profile user

pnpm exec dramaturge auth list
```

`dramaturge auth capture` opens a browser at the login URL and asks you to confirm whether login succeeded before saving the state. When using `--config`, the state file is written alongside the config file; when using `--url`, it is written to `.dramaturge-state/<profile>.json` in the current directory.

Note: the legacy helper binary `pnpm exec dramaturge-auth-state` is deprecated in favor of `dramaturge auth capture`.


## Configuration

The minimal config:

```json
{
  "targetUrl": "https://your-app.example.com",
  "appDescription": "Brief description of your app",
  "auth": {
    "type": "interactive",
    "loginUrl": "/login",
    "successIndicator": "selector:[data-testid='dashboard']"
  },
  "models": {
    "planner": "anthropic/claude-sonnet-4-6",
    "worker": "anthropic/claude-haiku-4-5"
  }
}
```

For more options, see [`dramaturge.config.example.json`](./dramaturge.config.example.json) or [Configuration Reference](#configuration-reference) below.

## GitHub Action

Add to `.github/workflows/qa.yml`:

```yaml
name: QA

on: [pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: aram10/dramaturge@v0.4.0
        with:
          config: dramaturge.config.json
          anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
          fail-on-severity: major
```

Dramaturge will post a comment on your PR with findings.

## What It Finds

- **Browser errors** — console errors, exceptions, network failures
- **Broken functionality** — forms that don't submit, links that 404
- **Accessibility issues** — powered by axe-core
- **API problems** — contract violations, auth issues, validation errors
- **Security vulnerabilities** — XSS, injection, broken auth (opt-in)
- **Visual regressions** — pixel-diff comparison (opt-in)

Every finding includes severity level, description, screenshot, and reproduction steps.

## LLM Providers

Works with:
- **Anthropic** (recommended) — Claude Sonnet/Haiku
- **OpenAI** — GPT-4o and GPT-4o-mini
- **Google** — Gemini models
- **Ollama** — Free local models
- **Custom OpenAI-compatible** — llama.cpp, vLLM, LocalAI

Set the appropriate API key:
```bash
export ANTHROPIC_API_KEY="..."
# or
export OPENAI_API_KEY="..."
# or
export GOOGLE_GENERATIVE_AI_API_KEY="..."
# or
export OLLAMA_BASE_URL="http://localhost:11434/v1"
```

## Advanced Features

### Framework-Aware Testing
Dramaturge can scan your codebase to understand routes and structure:
- **Next.js** — extracts routes, API endpoints, config
- **Django, Rails, Express, Nuxt, Remix** — heuristic route extraction
- **Generic** — works with any web app

### API Testing
Automatically tests observed API traffic against OpenAPI specs or discovered contracts.

### Memory Across Runs
Warm starts from previous exploration, tracks flaky pages, remembers historical findings.

### Adversarial Testing (Opt-In)
Security probes for OWASP Top 10, injection attacks, race conditions, and more.

For full feature details, see [`docs/features.md`](./docs/features.md).

---

## Documentation

- [Configuration Reference](#configuration-reference)
- [Authentication Guide](#authentication-guide)
- [GitHub Action Reference](#github-action-reference)
- [Troubleshooting](#troubleshooting)
- [Development Guide](./CONTRIBUTING.md)

## Configuration Reference

### Core Settings

```json
{
  "targetUrl": "https://your-app.example.com",
  "appDescription": "What your app does and its main features"
}
```

### Authentication Guide

<details>
<summary><b>Interactive (Manual Login)</b></summary>

Log in manually once. Dramaturge captures and reuses the session.

```json
{
  "auth": {
    "type": "interactive",
    "loginUrl": "/login",
    "successIndicator": "selector:[data-testid='user-menu']",
    "stateFile": "./.dramaturge-state/user.json",
    "manualTimeoutSeconds": 120
  }
}
```
</details>

<details>
<summary><b>Form Auth (Deterministic)</b></summary>

Provide credentials and selectors for automated login.

```json
{
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
}
```
</details>

<details>
<summary><b>OAuth Redirect (Multi-Step)</b></summary>

Script multi-step IdP flows.

```json
{
  "auth": {
    "type": "oauth-redirect",
    "loginUrl": "/login",
    "steps": [
      { "type": "click", "selector": "button[data-provider='google']" },
      { "type": "fill", "selector": "input[type='email']", "value": "${TEST_USER_EMAIL}" },
      { "type": "click", "selector": "input[type='submit']" },
      { "type": "fill", "selector": "input[type='password']", "value": "${TEST_USER_PASSWORD}", "secret": true },
      { "type": "click", "selector": "input[type='submit']" }
    ],
    "successIndicator": "selector:[data-testid='user-menu']"
  }
}
```
</details>

<details>
<summary><b>Stored State (Reuse Session)</b></summary>

Capture state once with `dramaturge auth capture`, then reuse:

```bash
npx dramaturge auth capture \
  --url https://your-app.example.com/login \
  --profile user
```

```json
{
  "auth": {
    "type": "stored-state",
    "stateFile": "./.dramaturge-state/user.json",
    "successIndicator": "selector:[data-testid='user-menu']"
  }
}
```
</details>

<details>
<summary><b>None (Public Pages)</b></summary>

Test public-facing pages without authentication.

```json
{
  "auth": { "type": "none" }
}
```
</details>

### Models

```json
{
  "models": {
    "planner": "anthropic/claude-sonnet-4-6",
    "worker": "anthropic/claude-haiku-4-5",
    "agentMode": "dom"
  }
}
```

- **planner** — Model for task planning (use smarter model)
- **worker** — Model for execution (use faster/cheaper model)
- **agentMode** — `"dom"` (faster, cheaper) or `"cua"` (sees viewport)

### Budget & Exploration

```json
{
  "budget": {
    "globalTimeLimitSeconds": 900,
    "maxStepsPerTask": 40,
    "maxStateNodes": 50
  }
}
```

### Output

```json
{
  "output": {
    "dir": "./dramaturge-reports",
    "format": "markdown",
    "screenshots": true
  }
}
```

Formats: `"markdown"`, `"json"`, or `"both"`

### Optional Features

<details>
<summary><b>API Testing</b></summary>

```json
{
  "apiTesting": {
    "enabled": true,
    "maxEndpointsPerNode": 4,
    "unauthenticatedProbes": true
  }
}
```
</details>

<details>
<summary><b>Adversarial Testing</b></summary>

```json
{
  "adversarial": {
    "enabled": true,
    "safeMode": true
  }
}
```
</details>

<details>
<summary><b>Visual Regression</b></summary>

```json
{
  "visualRegression": {
    "enabled": true,
    "baselineDir": "./.dramaturge/visual-baselines",
    "diffPixelRatioThreshold": 0.01
  }
}
```
</details>

<details>
<summary><b>Memory (Warm Start)</b></summary>

```json
{
  "memory": {
    "enabled": true,
    "dir": "./.dramaturge",
    "warmStart": true
  }
}
```
</details>

For complete config schema, see [`dramaturge.config.example.json`](./dramaturge.config.example.json).

## GitHub Action Reference

### Inputs

| Input | Description | Default |
|-------|-------------|---------|
| `config` | Path to config file | `dramaturge.config.json` |
| `target-url` | Override target URL | — |
| `anthropic-api-key` | Anthropic API key | — |
| `openai-api-key` | OpenAI API key | — |
| `fail-on-severity` | Fail if findings ≥ severity | — |
| `post-comment` | Post PR comment | `true` |
| `upload-report` | Upload as artifact | `true` |

### Outputs

| Output | Description |
|--------|-------------|
| `report-path` | Path to report directory |
| `finding-count` | Number of findings |
| `max-severity` | Highest severity found |

### Example

```yaml
- uses: aram10/dramaturge@v0.4.0
  with:
    config: dramaturge.config.json
    anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
    fail-on-severity: major
    post-comment: true
```

## Troubleshooting

### "Cannot find module" errors

Install Playwright browsers:
```bash
npx playwright install chromium
```

### Authentication failures

Check that your `successIndicator` selector matches an element on the authenticated page.

### No findings but issues exist

Increase exploration time:
```json
{
  "budget": {
    "globalTimeLimitSeconds": 1800
  }
}
```

### High LLM costs

Use cheaper models:
```json
{
  "models": {
    "planner": "anthropic/claude-haiku-4-5",
    "worker": "anthropic/claude-haiku-4-5"
  }
}
```

## Development

```bash
corepack enable
pnpm install
pnpm test
pnpm build
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) for contribution guidelines.

## License

Apache License 2.0 — see [LICENSE](./LICENSE).

## Links

- [Repository](https://github.com/aram10/dramaturge)
- [Issues](https://github.com/aram10/dramaturge/issues)
- [Changelog](./CHANGELOG.md)

---

**Built with TypeScript, Node.js, Playwright, and Stagehand**
