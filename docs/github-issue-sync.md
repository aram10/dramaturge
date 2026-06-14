# Idempotent GitHub Issue Sync

`scripts/sync-github-issues.mjs` reconciles this repository's GitHub Issues with
a declarative manifest — the **desired state**. It is the programmatic way to
"close some, modify others, and add new ones" in a single, repeatable pass.

Running it repeatedly against an unchanged manifest makes **no writes**: the
operation is fully idempotent.

## Why a manifest?

The agent cannot call the GitHub Issues API directly, but it can edit a JSON
file. So the desired state of the tracker lives in version control
(`scripts/github-issues.json`), and the script applies whatever that file says.
Edit the manifest, review the dry-run, then apply.

## The manifest

```jsonc
{
  // Marker label applied to every managed issue. The script only ever
  // touches issues carrying this label, so hand-made issues are left alone.
  "label": "sync:managed",
  "issues": [
    {
      "key": "stable-slug",        // REQUIRED, immutable identity (not the title)
      "title": "Issue title",       // REQUIRED
      "body": "Markdown body",      // optional
      "labels": ["enhancement"],    // optional, merged with the marker label
      "state": "open",              // optional: "open" (default) or "closed"
      "assignees": ["aram10"]        // optional
    }
  ]
}
```

`scripts/github-issues.example.json` shows all three operations (add, modify,
close) together.

### Identity & idempotency

Each managed issue is tracked two ways:

1. **Marker label** (default `sync:managed`) — discovers the set of issues the
   script owns.
2. **Stable `key`** — embedded in the issue body as `<!-- sync-key: <key> -->`.
   Because the key (not the title) is the identity, you can rewrite a title or
   body without the script losing track of the issue.

## Reconciliation rules

| Situation                                            | Action                |
| ---------------------------------------------------- | --------------------- |
| `key` in manifest, not on GitHub                     | **create** the issue  |
| `key` in manifest and on GitHub, fields differ       | **update** the issue  |
| `key` in manifest with `"state": "closed"`           | ensure issue closed   |
| Managed issue whose `key` was removed from manifest  | **close** it (prune)  |
| Everything already matches                           | no-op                 |

Pruning (closing issues that left the manifest) is on by default; pass
`--no-prune` to disable it. Issues are never deleted — only closed.

## Usage

```bash
# Preview (dry-run) using the default manifest. No token needed for a
# manifest-only preview, but a token is required to diff against live issues.
node scripts/sync-github-issues.mjs

# Preview against the live tracker
GITHUB_TOKEN=ghp_xxx node scripts/sync-github-issues.mjs

# Apply the changes
GITHUB_TOKEN=ghp_xxx node scripts/sync-github-issues.mjs --apply

# Or via the npm script
GITHUB_TOKEN=ghp_xxx pnpm run sync:issues -- --apply
```

### Options

| Flag                 | Description                                                        |
| -------------------- | ----------------------------------------------------------------- |
| `--manifest <path>`  | Manifest JSON path (default `scripts/github-issues.json`)          |
| `--repo <owner/name>`| Target repo (default `$GITHUB_REPOSITORY` or `package.json`)       |
| `--token <token>`    | GitHub token (default `$GITHUB_TOKEN` / `$GH_TOKEN`)               |
| `--apply`            | Perform writes (default is dry-run)                               |
| `--no-prune`         | Do not close managed issues that left the manifest                |
| `--help`             | Show usage                                                         |

The token needs `repo` (classic) or `issues:write` (fine-grained) scope.

## Safety

- **Dry-run by default** — nothing is written until you pass `--apply`.
- Only issues carrying the marker label are ever modified.
- Labels referenced in the manifest are auto-created by GitHub on first use.
