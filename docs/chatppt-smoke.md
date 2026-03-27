# ChatPPT Local Smoke Runbook

## Purpose

This runbook validates that Dramaturge can orient itself in a local ChatPPT environment, authenticate, discover the main route families, and produce useful findings without getting derailed by expected auth noise.

## Prerequisites

- the ChatPPT frontend is already reachable at `http://localhost:3000`
- the backend APIs the app depends on are already running
- an LLM provider key is exported, for example `ANTHROPIC_API_KEY`
- you can complete a normal ChatPPT sign-in flow in a visible browser

Starting the host application stack is intentionally outside the scope of this package. Dramaturge assumes the target environment is already up.

## 1. Optional: pre-seed browser auth state

If you want to avoid an interactive login during the Dramaturge run, seed a package-local storage-state file first:

```powershell
pnpm exec dramaturge-auth-state `
  --url http://localhost:3000/login `
  --output ./.dramaturge-state/chatppt-user.json `
  --success-url http://localhost:3000/
```

You can skip this step. The ChatPPT profile uses `interactive` auth and will fall back to manual sign-in automatically.

## 2. Run Dramaturge with the ChatPPT profile

From this package directory:

```powershell
pnpm exec dramaturge --config examples/chatppt.local.profile.jsonc
```

What to expect:

- if `./.dramaturge-state/chatppt-user.json` is valid, Dramaturge reuses it
- otherwise Dramaturge opens a visible browser window at `/login`
- complete Microsoft sign-in manually if prompted
- Dramaturge waits until `selector:[data-testid='user-nav-button']` appears, then caches the refreshed state and continues

## 3. Optional: add source-aware ChatPPT hints

The shipped ChatPPT example is self-contained and does not require source access. If you also have a ChatPPT checkout and want route and selector hints from source, add `repoContext` to a copied config:

```jsonc
"repoContext": {
  "root": "C:/src/chatppt",
  "framework": "nextjs"
}
```

That keeps repo scanning opt-in instead of assuming the app repo lives next to the package.

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

A healthy first run should show that Dramaturge:

- authenticates successfully
- recognizes the chat and manage route families
- suppresses expected `401` or `403` protected-route noise
- returns findings with evidence and repro metadata
- leaves behind understandable blind spots instead of silently skipping work

Even a zero-finding run is useful if the report shows believable coverage and clearly bounded blind spots.
