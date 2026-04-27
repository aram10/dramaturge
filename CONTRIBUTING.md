# Contributing to Dramaturge

Thank you for contributing! This guide covers the conventions every contributor
(human or automated agent) should follow.

## Commit Messages

This repository uses **Conventional Commits** to drive automated releases.
Every commit merged into `main` must have a prefix that describes its intent:

| Prefix | Purpose | Version bump |
|---|---|---|
| `feat:` | New feature | minor |
| `fix:` | Bug fix | patch |
| `docs:` | Documentation only | none |
| `chore:` | Maintenance / tooling | none |
| `refactor:` | Code change that neither fixes a bug nor adds a feature | none |
| `test:` | Adding or updating tests | none |
| `perf:` | Performance improvement | patch |
| `ci:` | CI/CD changes | none |

Append `!` after the prefix (e.g. `feat!:`) or add a `BREAKING CHANGE:` footer
to signal a **major** version bump.

## Changelog

**Do not edit `CHANGELOG.md` by hand.**

The changelog is generated automatically by
[release-please](https://github.com/googleapis/release-please) from the
Conventional Commit messages when a release PR is merged. Writing clear,
descriptive commit messages is the only action required to keep the changelog
accurate.

## Development

```bash
corepack enable          # activate pnpm
pnpm install             # install dependencies
pnpm test                # run tests (vitest)
pnpm build               # compile TypeScript → dist/
pnpm run verify:standalone  # smoke-check the packaged tarball
```

## Architecture

- Layer boundaries are documented in `docs/architecture/layers.md`.
- Architecture decisions are recorded under `docs/adr/`.
- New runtime features should preserve those boundaries and add tests when they introduce a new dependency seam.

## Pull Requests

1. Create a feature branch from `main`.
2. Make your changes with well-formed Conventional Commit messages.
3. Ensure `pnpm test` and `pnpm build` pass locally.
4. Open a PR against `main` — CI will run the same checks automatically.
