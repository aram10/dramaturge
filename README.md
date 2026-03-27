# Dramaturge

Dramaturge is an environment-aware exploratory QA harness for web applications.

It combines agentic browser exploration with deterministic auth flows, evidence capture, run memory, visual baselines, and structured reporting so you can investigate unfamiliar apps without dropping straight into brittle handwritten test suites.

## Install

```bash
pnpm add @aram10/dramaturge
pnpm exec playwright install chromium
```

For GitHub Packages, configure an `.npmrc` like:

```text
@aram10:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

## Run

Create a config from [`dramaturge.config.example.json`](./dramaturge.config.example.json), then run:

```bash
pnpm exec dramaturge --config ./dramaturge.config.json
```

You can also capture reusable auth state with:

```bash
pnpm exec dramaturge-auth-state \
  --url https://your-app.example.com/login \
  --output ./.dramaturge-state/user.json \
  --success-url https://your-app.example.com/
```

## What It Does

- explores apps with specialized `navigation`, `form`, and `crud` workers
- supports `interactive`, `stored-state`, `form`, `oauth-redirect`, and `none` auth modes
- captures console and network failures as evidence-backed findings
- stores cross-run memory under `.dramaturge/` for warm starts and finding history
- supports deterministic visual regression baselines with `pixelmatch`
- emits Markdown and JSON reports with structured repro details

## Example Config

The bundled [`dramaturge.config.example.json`](./dramaturge.config.example.json) is the canonical starting point for local and deployed targets. It keeps auth state, reports, memory, and visual baselines inside the directory that holds the config file, so the package stays portable when copied or installed elsewhere.

## Verify The Package

From the package root:

```bash
pnpm build
pnpm test
pnpm run verify:standalone
```

That smoke check packs the package, installs it into a temporary directory outside the repo, runs `dramaturge --help`, and validates that the packaged example config resolves to package-local paths.
