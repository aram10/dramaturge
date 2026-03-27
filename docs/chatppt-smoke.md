# ChatPPT Local Smoke Runbook

## Purpose

This runbook validates that WebProbe can orient itself in the local ChatPPT environment, authenticate, discover the main route families, and produce useful findings without getting derailed by expected auth noise.

## Prerequisites

- `.env.local` is populated for the main repo
- Docker Desktop is running
- An LLM provider key is exported, for example `ANTHROPIC_API_KEY`
- You are working from the repo root that contains both `webprobe/` and the main ChatPPT app

## 1. Start the local stack

From the repo root:

```powershell
pnpm local:up -- --backend-ref main
```

Wait for the app and backend to come up. The important local endpoints are:

- `http://localhost:3000` for the web app
- `http://localhost:7071/api` for the backend

## 2. Optional: pre-seed browser auth state

If you want to avoid an interactive login during the WebProbe run, seed the shared Playwright auth file first:

```powershell
npx tsx tests/interactive-login.ts
```

This writes `playwright/.auth/user.json`, which the ChatPPT WebProbe profile reuses.

You can skip this step. The profile uses `interactive` auth and will fall back to manual sign-in automatically.

## 3. Run WebProbe with the ChatPPT profile

From `webprobe/`:

```powershell
npx tsx src/index.ts --config examples/chatppt.local.profile.jsonc
```

What to expect:

- If `../playwright/.auth/user.json` is valid, WebProbe reuses it.
- Otherwise WebProbe opens a visible browser window at `/login`.
- Complete Microsoft sign-in manually if prompted.
- WebProbe waits until `selector:[data-testid='user-nav-button']` appears, then caches the refreshed state and continues.

## 4. First flows to watch

The example profile is tuned to prioritize:

- authenticated arrival on the chat shell
- sidebar navigation to knowledge bases
- `/manage` discovery, especially `/manage/knowledge-bases`
- knowledge-base form validation rather than destructive mutation

The profile intentionally de-emphasizes:

- `/manage/groups`
- `/manage/feedback`
- dashboard danger-zone actions

## 5. Interpreting the report

Review both:

- `report.md` for the human summary
- `report.json` for machine-readable findings and repro metadata

Pay attention to three report concepts:

- `Confidence`
  How strongly the harness believes the finding is real.
- `Repro`
  Route, objective, breadcrumbs, and evidence ids for replay.
- `Blind Spots`
  Areas the run could not cover because of time, policy, or state reachability limits. Blind spots are not bugs, but they do tell you where confidence is lower.

## 6. What counts as a good smoke run

A healthy first run should show that WebProbe:

- authenticates successfully
- recognizes the chat and manage route families
- suppresses expected 401 or 403 protected-route noise
- returns findings with evidence and repro metadata
- leaves behind understandable blind spots instead of silently skipping work

Even a zero-finding run is useful if the report shows believable coverage and clearly bounded blind spots.
