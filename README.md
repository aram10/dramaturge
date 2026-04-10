# Dramaturge

[![CI](https://github.com/aram10/dramaturge/actions/workflows/ci.yml/badge.svg)](https://github.com/aram10/dramaturge/actions/workflows/ci.yml)
[![Lint](https://github.com/aram10/dramaturge/actions/workflows/lint.yml/badge.svg)](https://github.com/aram10/dramaturge/actions/workflows/lint.yml)
[![Coverage](https://codecov.io/gh/aram10/dramaturge/branch/main/graph/badge.svg)](https://codecov.io/gh/aram10/dramaturge)
[![License: GPL-3.0](https://img.shields.io/badge/License-GPL--3.0-blue.svg)](https://opensource.org/licenses/GPL-3.0)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org)
[![Package Manager](https://img.shields.io/badge/package%20manager-pnpm%209-orange)](https://pnpm.io)

**Dramaturge** is an agentic exploratory QA engine for web applications. It uses LLM-driven browser agents to autonomously explore, test, and report findings on live web apps—discovering bugs, accessibility issues, API contract violations, security vulnerabilities, and visual regressions without writing test scripts.

## Why Dramaturge?

Traditional QA approaches require upfront investment in test suites, selectors, and expected states. Dramaturge inverts this model:

- **Start testing immediately** — point it at a URL and let agents explore
- **Discover the unexpected** — finds issues you didn't think to test for
- **No brittle selectors** — LLM agents adapt to UI changes naturally
- **Multi-layer coverage** — UI flows, API contracts, security probes, accessibility, visual regression
- **Evidence-backed findings** — every issue includes screenshots, traces, and reproduction steps
- **Memory across runs** — warm starts from previous exploration, tracks flaky pages and finding history

**Perfect for:**
- Exploratory testing of legacy applications with little documentation
- Pre-release smoke testing to catch regressions before deployment
- Security and accessibility audits without manual inspection
- API contract validation against live traffic
- Onboarding new team members to unfamiliar codebases

## Features

### 🤖 Specialized Worker Types
- **Navigation workers** — discover routes, follow links, map application structure
- **Form workers** — fill forms, test validation, explore multi-step flows
- **CRUD workers** — create, read, update operations (delete opt-in only)
- **API workers** — replay observed traffic, validate contracts, test auth boundaries
- **Adversarial workers** — security probes, edge cases, OWASP scenarios (opt-in)

### 🔐 Flexible Authentication
- **Interactive** — manual login with session capture for replay
- **Stored state** — reuse pre-captured browser state across runs
- **Form auth** — deterministic login with explicit selectors
- **OAuth redirect** — scripted multi-step IdP flows
- **None** — test public-facing pages without authentication

### 🔍 Comprehensive Testing
- **Browser error capture** — console errors, uncaught exceptions, network failures
- **Accessibility testing** — powered by axe-core via Playwright
- **Visual regression** — deterministic baselines with pixelmatch diff detection
- **API contract validation** — replay traffic against OpenAPI specs or discovered contracts
- **Web vitals** — performance metrics (CLS, LCP, INP)
- **Cost tracking** — LLM token usage per worker type

### 📊 Intelligent Reporting
- **Markdown reports** — human-readable findings with severity levels
- **JSON reports** — structured data for CI/CD integration
- **Screenshot evidence** — visual proof for every finding
- **Playwright test generation** — convert findings into executable test specs with inferred assertions
- **Reproduction metadata** — detailed traces for debugging

### 🧠 Cross-Run Memory
- **Warm starts** — resume exploration from previous state graph
- **Finding history** — track recurrence and resolution across runs
- **Flaky page detection** — identify unstable routes
- **Frontier persistence** — save and restore exploration queue

### 🏗️ Framework-Aware Scanning
- **Next.js** — route analysis, API route detection, config parsing
- **Django, Rails, Express, Nuxt, Remix** — heuristic extraction of routes, selectors, and API hints
- **Generic web apps** — fallback adapter for any application
- **OpenAPI support** — load external contract files (`.json`, `.jsonc`, `.yaml`, `.yml`)

## Installation

### Prerequisites
- **Node.js** ≥ 20
- **pnpm** 9 (or npm/yarn for installing only; pnpm recommended for development)
- **LLM API keys** — Anthropic (recommended), OpenAI, or Google Generative AI

### Package Installation

```bash
pnpm add dramaturge
pnpm exec playwright install chromium
```

## Run

Copy the example config and customize for your application:

```bash
curl -O https://raw.githubusercontent.com/aram10/dramaturge/main/dramaturge.config.example.json
mv dramaturge.config.example.json dramaturge.config.json
```

Edit `dramaturge.config.json` with your target URL and settings:

```json
{
  "targetUrl": "https://your-app.example.com",
  "appDescription": "Your app description here",
  "auth": {
    "type": "interactive",
    "loginUrl": "/login",
    "successIndicator": "selector:[data-testid='user-menu']",
    "stateFile": "./.dramaturge-state/user.json",
    "manualTimeoutSeconds": 120
  },
  "models": {
    "planner": "anthropic/claude-sonnet-4-6",
    "worker": "anthropic/claude-haiku-4-5",
    "agentMode": "cua"
  },
  "output": {
    "dir": "./dramaturge-reports/default",
    "format": "markdown"
  }
}
```

See the [Configuration Guide](#configuration) below for detailed options.

### 2. Set API Keys

Export your LLM provider API key:

```bash
export ANTHROPIC_API_KEY="your-key-here"
# OR
export OPENAI_API_KEY="your-key-here"
# OR
export GOOGLE_GENERATIVE_AI_API_KEY="your-key-here"
```

### 3. Run Dramaturge

```bash
pnpm exec dramaturge --config ./dramaturge.config.json
```

The engine will:
1. Bootstrap authentication (if configured)
2. Explore your application with specialized workers
3. Capture findings with evidence (screenshots, traces)
4. Generate reports in the configured output directory

### 4. Review Results

Check the output directory for:
- `report.md` — human-readable findings summary
- `report.json` — structured data for CI/CD
- `screenshots/` — visual evidence for findings
- `generated-tests/` — Playwright test specs (if enabled)

## Capturing Authentication State

For `stored-state` auth mode, capture reusable session state interactively:

```bash
pnpm exec dramaturge-auth-state \
  --url https://your-app.example.com/login \
  --output ./.dramaturge-state/user.json \
  --success-url https://your-app.example.com/dashboard
```

This opens a browser where you can manually log in. Once authenticated and the success URL is reached, the browser state is saved to the output file for reuse in future runs.

## GitHub Action

Integrate Dramaturge into your CI/CD pipeline with the composite GitHub Action.

### Basic Usage

Create `.github/workflows/qa.yml`:

```yaml
name: Exploratory QA

on:
  pull_request:
  push:
    branches: [main]

jobs:
  dramaturge:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Run Dramaturge
        uses: aram10/dramaturge@v0.2.0
        with:
          config: dramaturge.config.json
          target-url: https://staging.your-app.example.com
          anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
          fail-on-severity: major
          post-comment: true
```

### Action Inputs

| Input | Description | Default |
|-------|-------------|---------|
| `config` | Path to config file | `dramaturge.config.json` |
| `target-url` | Target URL (overrides config) | — |
| `anthropic-api-key` | Anthropic API key | — |
| `openai-api-key` | OpenAI API key | — |
| `google-api-key` | Google Generative AI API key | — |
| `fail-on-severity` | Fail if findings ≥ severity (`critical`, `major`, `minor`, `trivial`) | — |
| `upload-report` | Upload report as artifact | `true` |
| `post-comment` | Post PR comment with summary | `true` |
| `report-dir` | Report directory (overrides config) | — |
| `force-json-output` | Force JSON output for CI parsing | `true` |
| `force-headless` | Force headless browser mode | `true` |
| `working-directory` | Working directory | `.` |
| `node-version` | Node.js version | `20` |
| `dramaturge-version` | Package version to install | `latest` |

### Action Outputs

| Output | Description |
|--------|-------------|
| `report-path` | Path to generated report directory |
| `finding-count` | Total number of findings |
| `max-severity` | Highest severity level found (`Critical`, `Major`, `Minor`, `Trivial`, or `none`) |

### Advanced Example

```yaml
- name: Run Dramaturge with custom settings
  uses: aram10/dramaturge@v0.2.0
  with:
    config: .dramaturge/staging.config.json
    target-url: https://pr-${{ github.event.pull_request.number }}.preview.example.com
    anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
    fail-on-severity: major
    upload-report: true
    post-comment: true
    force-json-output: true
    force-headless: true
    working-directory: ./app
    dramaturge-version: 0.2.0

- name: Process findings
  if: always()
  run: |
    echo "Found ${{ steps.dramaturge.outputs.finding-count }} issues"
    echo "Max severity: ${{ steps.dramaturge.outputs.max-severity }}"
```

### Important Notes

- **`force-json-output`** — Leave enabled (default `true`) when you rely on PR comments, `fail-on-severity`, or structured outputs. JSON parsing enables machine-readable CI integration. Set to `false` only if you want markdown-only reports and don't need CI features.
- **`force-headless`** — Defaults to `true` for CI environments. Set to `false` to preserve your config's `browser.headless` value.
- **PR Comments** — Automatically posted when `post-comment: true` and the workflow is triggered by a pull request. Existing comments are updated instead of creating duplicates.

## Configuration

The configuration file controls all aspects of Dramaturge's behavior. The bundled [`dramaturge.config.example.json`](./dramaturge.config.example.json) is the canonical starting point.

### Core Settings

```json
{
  "targetUrl": "https://your-app.example.com",
  "appDescription": "Describe your app: what it does, main features, user roles"
}
```

### Authentication

Choose from five auth strategies:

#### Interactive (Manual Login)
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

#### Stored State (Reuse Captured Session)
```json
{
  "auth": {
    "type": "stored-state",
    "stateFile": "./.dramaturge-state/user.json",
    "successIndicator": "selector:[data-testid='user-menu']"
  }
}
```

#### Form Auth (Deterministic Selectors)
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

#### OAuth Redirect (Multi-Step IdP)
```json
{
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
}
```

#### None (Public Pages Only)
```json
{
  "auth": { "type": "none" }
}
```

### Models

```json
{
  "models": {
    "planner": "anthropic/claude-sonnet-4-6",
    "worker": "anthropic/claude-haiku-4-5",
    "browserOps": "anthropic/claude-haiku-4-5",
    "agentMode": "cua",
    "agentModes": {
      "navigation": "dom",
      "form": "dom",
      "crud": "cua"
    }
  }
}
```

- **`planner`** — Model for task planning and prioritization
- **`worker`** — Model for worker execution
- **`browserOps`** — Model for Stagehand operations (defaults to `planner` if omitted)
- **`agentMode`** — Global agent mode: `cua` (computer-use, sees viewport) or `dom` (DOM inspection)
- **`agentModes`** — Per-worker-type overrides

### Mission

```json
{
  "mission": {
    "criticalFlows": [
      "Create a new record",
      "Edit an existing record",
      "Search and filter the list"
    ],
    "destructiveActionsAllowed": false,
    "focusModes": ["navigation", "form", "crud", "api"]
  }
}
```

### API Testing

```json
{
  "apiTesting": {
    "enabled": true,
    "maxEndpointsPerNode": 4,
    "maxProbeCasesPerEndpoint": 6,
    "unauthenticatedProbes": true,
    "allowMutatingProbes": false
  }
}
```

### Adversarial Testing (Opt-In)

```json
{
  "adversarial": {
    "enabled": false,
    "maxSequencesPerNode": 3,
    "safeMode": true,
    "includeAuthzProbes": false,
    "includeConcurrencyProbes": false
  }
}
```

### Budget & Exploration

```json
{
  "budget": {
    "globalTimeLimitSeconds": 900,
    "maxStepsPerTask": 40,
    "maxFrontierSize": 200,
    "maxStateNodes": 50
  },
  "exploration": {
    "maxAreasToExplore": 10,
    "stepsPerArea": 40,
    "totalTimeout": 900
  }
}
```

### Output

```json
{
  "output": {
    "dir": "./dramaturge-reports/default",
    "format": "markdown",
    "screenshots": true
  }
}
```

- **`format`** — `"markdown"`, `"json"`, or `"both"`

### Memory

```json
{
  "memory": {
    "enabled": true,
    "dir": "./.dramaturge",
    "warmStart": true
  }
}
```

### Visual Regression

```json
{
  "visualRegression": {
    "enabled": false,
    "baselineDir": "./.dramaturge/visual-baselines",
    "diffPixelRatioThreshold": 0.01,
    "maskSelectors": []
  }
}
```

First run captures baselines; subsequent runs compare and emit findings when threshold is exceeded.

### Repository Context (Framework-Aware)

```json
{
  "repoContext": {
    "root": "./host-app",
    "framework": "auto"
  }
}
```

- **`framework`** — `"auto"`, `"nextjs"`, `"django"`, `"rails"`, `"express"`, `"nuxt"`, `"remix"`, or `"generic"`

### Browser

```json
{
  "browser": {
    "headless": false
  }
}
```

### LLM Timeouts

```json
{
  "llm": {
    "requestTimeoutMs": 30000
  }
}
```

### Auto-Capture (Browser Telemetry)

```json
{
  "autoCapture": {
    "consoleErrors": true,
    "consoleWarnings": false,
    "networkErrors": true,
    "networkErrorMinStatus": 400
  }
}
```

Console warnings are **off by default** to reduce noise. Enable for broader telemetry.

## Architecture

Dramaturge uses a **frontier-based exploration loop**:

1. **Planner** — generates tasks from state graph nodes, prioritizes by strategic value
2. **Frontier Queue** — maintains pending tasks sorted by priority
3. **Workers** — execute tasks via Stagehand agents with typed tools (`log_finding`, `take_screenshot`, etc.)
4. **Graph Expansion** — discovered pages/routes become new nodes, edges capture navigation paths
5. **Repeat** — until budget exhausted or frontier empty

### Worker Types

| Type | Purpose | Default Mode |
|------|---------|--------------|
| `navigation` | Discover routes, follow links | `dom` |
| `form` | Fill forms, test validation | `dom` |
| `crud` | Create, read, update operations | `cua` |
| `api` | Replay traffic, validate contracts | — |
| `adversarial` | Security probes, edge cases (opt-in) | `cua` |

### Agent Modes

- **`cua`** (computer-use agent) — sees viewport screenshots, useful for visual interactions
- **`dom`** (DOM inspection) — sees DOM tree, faster and cheaper for form/navigation tasks

### Multi-Agent Protocol (A2A)

Optional advanced orchestration with:
- **Coordinator** — delegates tasks to specialized roles
- **Blackboard** — shared state for cross-agent communication
- **MessageBus** — inter-agent messaging
- **Agent roles** — Scout, Tester, Security, Reviewer, Reporter

Enable with `a2a` config section (not shown in example config; see source code for details).

## Support Matrix

| Target Type | Support Level |
|-------------|---------------|
| Browser-only target (no repo) | ✅ Fully supported |
| Generic web app with repo | ✅ Heuristic extraction of routes/selectors/API hints |
| Next.js with repo | ✅ **Strongest support** — route analysis, API detection |
| Django, Rails, Express, Nuxt, Remix | ✅ Framework-aware adapters |
| External OpenAPI spec | ✅ `.json`, `.jsonc`, `.yaml`, `.yml` |
| GraphQL contracts | ⚠️ Not first-class yet |
| Destructive operations | ⚠️ Opt-in only (`destructiveActionsAllowed`, `adversarial.safeMode`) |

## Troubleshooting

### "Cannot find module" errors

Ensure Playwright browsers are installed:
```bash
pnpm exec playwright install chromium
```

### Authentication failures

- **Interactive/stored-state** — verify `successIndicator` selector matches your authenticated page
- **Form auth** — check selector paths and environment variable interpolation (`${VAR}`)
- **OAuth redirect** — ensure all step selectors are correct; add `wait-for-selector` between steps if needed

### "No findings" but issues exist

- Increase `budget.globalTimeLimitSeconds` or `exploration.totalTimeout` for longer runs
- Check `mission.focusModes` includes relevant worker types
- Enable `adversarial` or `apiTesting` if needed
- Review `memory.dir` for flaky page tracking (may skip unstable routes)

### High LLM costs

- Use cheaper models for `worker` and `browserOps`: `anthropic/claude-haiku-4-5`
- Reduce `budget.maxStepsPerTask` or `exploration.stepsPerArea`
- Disable expensive features: `adversarial.enabled: false`, `apiTesting.enabled: false`
- Check `coverage/cost-tracker.ts` for per-worker token usage in reports

### Visual regression false positives

- Increase `visualRegression.diffPixelRatioThreshold` (default `0.01` = 1%)
- Add `maskSelectors` for dynamic content (timestamps, ads, user avatars)

### GitHub Action not posting PR comments

- Ensure `force-json-output: true` (default) — PR comments require `report.json`
- Check workflow has `pull_request` trigger
- Verify GitHub token has `write` permission for PR comments

## Development

Contributing to Dramaturge? See [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

```bash
corepack enable          # activate pnpm
pnpm install             # install dependencies
pnpm test                # run tests (vitest)
pnpm build               # compile TypeScript → dist/
pnpm run verify:standalone  # smoke-check the packaged tarball
```

## License

Dramaturge is licensed under the [GNU General Public License v3.0](./LICENSE).

## Links

- **Repository**: [https://github.com/aram10/dramaturge](https://github.com/aram10/dramaturge)
- **Issues**: [https://github.com/aram10/dramaturge/issues](https://github.com/aram10/dramaturge/issues)
- **Package**: [@aram10/dramaturge on GitHub Packages](https://github.com/aram10/dramaturge/pkgs/npm/dramaturge)

---

**Built with**: TypeScript · Node.js · Playwright · Stagehand · Zod · Vitest · React/Ink
