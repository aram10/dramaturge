# Dramaturge

[![CI](https://github.com/aram10/dramaturge/actions/workflows/ci.yml/badge.svg)](https://github.com/aram10/dramaturge/actions/workflows/ci.yml)
[![Lint](https://github.com/aram10/dramaturge/actions/workflows/lint.yml/badge.svg)](https://github.com/aram10/dramaturge/actions/workflows/lint.yml)
[![Coverage](https://codecov.io/gh/aram10/dramaturge/branch/main/graph/badge.svg)](https://codecov.io/gh/aram10/dramaturge)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org)

**Autonomous QA testing for web applications.** Point Dramaturge at your app and it will explore, test, and report issues—no test scripts required.

## Quick Start

```bash
# Install
npm install dramaturge
npx playwright install chromium

# Generate config
npx dramaturge auto-config

# Set API key (choose one provider)
export ANTHROPIC_API_KEY="your-key-here"
# See LLM Providers section for other options

# Run
npx dramaturge --config dramaturge.config.json
```

## What It Does

Dramaturge uses LLM-driven browser agents to autonomously test web applications:

- **Explores** — Navigates links, fills forms, tests workflows
- **Finds bugs** — Console errors, broken pages, network failures, validation issues
- **Checks accessibility** — Runs axe-core on every page (WCAG compliance)
- **Tests APIs** — Validates contracts, auth boundaries, error responses
- **Security testing** — OWASP scenarios, injection attacks (opt-in)
- **Visual regression** — Pixel-diff comparison (opt-in)
- **Provides evidence** — Screenshots, reproduction steps, network traces

No test scripts. No brittle selectors. Works with any web framework.

## Configuration

Minimal example:

```json
{
  "targetUrl": "https://your-app.example.com",
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

**Auth strategies:** `interactive` (manual login), `form` (automated), `oauth-redirect` (multi-step), `stored-state` (reuse session), `none` (public). See [Authentication Guide](#authentication-guide) for details.

**Capture auth state:**
```bash
npx dramaturge auth capture --profile user
```

For full options, see [`dramaturge.config.example.json`](./dramaturge.config.example.json) or [Configuration Reference](#configuration-reference).

## LLM Providers

Dramaturge supports multiple providers via model-string prefixes (e.g., `anthropic/claude-sonnet-4-6`). Omitting the prefix defaults to Anthropic.

| Prefix | Provider | Environment Variables |
|--------|----------|----------------------|
| `anthropic/…` | Anthropic | `ANTHROPIC_API_KEY` |
| `openai/…` | OpenAI | `OPENAI_API_KEY`, `OPENAI_BASE_URL` (optional) |
| `google/…` | Google Generative AI | `GOOGLE_GENERATIVE_AI_API_KEY` |
| `azure/…` | Azure AI Foundry | `AZURE_AI_ENDPOINT`, `AZURE_AI_API_KEY` |
| `openrouter/…` | OpenRouter | `OPENROUTER_API_KEY` |
| `github/…` | GitHub Models | `GITHUB_TOKEN` |
| `ollama/…` | Ollama | `OLLAMA_BASE_URL` |
| `custom/…` | OpenAI-compatible | `OPENAI_COMPATIBLE_BASE_URL` |

**Agent modes:** `"dom"` (DOM inspection, portable) or `"cua"` (computer-use, requires vision model).

**Note:** AWS Bedrock, Cohere, and Mistral native APIs require OpenAI-compatible proxies via `custom/…`.

## Confirming Fixes

After fixing a bug, replay saved actions to verify:

```bash
# Confirm one finding from latest report
npx dramaturge confirm --finding BUG-0042

# Confirm all major+ findings from specific report
npx dramaturge confirm --severity major+ --from-report ./dramaturge-reports/2026-05-20T18-46-40

# Confirm all findings
npx dramaturge confirm --all
```

**Exit codes:** `0` = all fixed, `1` = issues remain, `2` = cannot confirm, `3` = needs review.

## Building Regression Tests

Promote findings to durable Playwright specs:

```bash
# Show promotable findings
npx dramaturge regress list

# Preview generated spec
npx dramaturge regress promote BUG-0042 --dry-run

# Write spec to ./tests/dramaturge
npx dramaturge regress promote BUG-0042
```

Quality scores consider URL context, actions, evidence, screenshots, and confidence. Only findings with replay actions and clear expected/actual differences are promotable.

## CI/CD Integration

Add to `.github/workflows/qa.yml`:

```yaml
- uses: aram10/dramaturge@v0.4.0
  with:
    config: dramaturge.config.json
    anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
    fail-on-severity: major
```

See [GitHub Action Reference](#github-action-reference) for all options.

---

## Documentation

- [Configuration Reference](#configuration-reference) — Full config options
- [Authentication Guide](#authentication-guide) — All auth strategies with examples
- [GitHub Action Reference](#github-action-reference) — CI/CD integration details
- [Troubleshooting](#troubleshooting) — Common issues and solutions
- [Development Guide](./CONTRIBUTING.md) — Contributing to Dramaturge

## Configuration Reference

### Core Settings

```json
{
  "targetUrl": "https://your-app.example.com",
  "appDescription": "What your app does and its main features"
}
```

### Models

```json
{
  "models": {
    "planner": "anthropic/claude-sonnet-4-6",
    "worker": "anthropic/claude-haiku-4-5",
    "browserOps": "anthropic/claude-sonnet-4-6",
    "agentMode": "dom",
    "agentModes": {
      "navigation": "dom",
      "form": "dom",
      "crud": "dom",
      "adversarial": "dom"
    }
  }
}
```

- **planner** — Task planning (use smarter model)
- **worker** — Execution (use faster/cheaper model)
- **browserOps** — Browser agent runtime (defaults to `planner`)
- **agentMode** — `"dom"` (faster, cheaper) or `"cua"` (sees viewport)
- **agentModes** — Per-worker overrides

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

See [`dramaturge.config.example.json`](./dramaturge.config.example.json) for complete schema.

## Authentication Guide

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
npx dramaturge auth capture --url https://your-app.example.com/login --profile user
# or from config: npx dramaturge auth capture --config dramaturge.config.json --profile user
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

## GitHub Action Reference

### Inputs

| Input | Description | Default |
|-------|-------------|---------|
| `config` | Path to config file | `dramaturge.config.json` |
| `target-url` | Override target URL | — |
| `anthropic-api-key` | Anthropic API key | — |
| `openai-api-key` | OpenAI API key | — |
| `google-api-key` | Google Generative AI API key | — |
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
