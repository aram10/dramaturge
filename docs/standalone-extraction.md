# Standalone Extraction

Dramaturge is designed so the current package folder can be copied to a new location or extracted into its own repository without depending on parent-repo scripts, parent-repo paths, or undeclared runtime dependencies.

## What “self-contained” means here

- all Dramaturge runtime logic lives under this folder
- all runtime dependencies are declared in [`package.json`](../package.json)
- local and live probing do not require any sibling repository
- source-aware scanning is opt-in through `repoContext.root`
- packaged examples use package-local state and report paths

## Extract the folder

1. Copy this package folder to the destination directory or promote it to its own repository root.
2. Run `pnpm install`.
3. Run `pnpm build`.
4. Run `pnpm test`.
5. Run `pnpm run verify:standalone`.

That last command packs the package, installs it in a temp directory outside the current repo, runs the CLI, loads the packaged standalone example, and fails if the packed artifact still contains host-repo references.

## Local and live runs after extraction

Start from one of the shipped configs:

- [`../dramaturge.config.example.json`](../dramaturge.config.example.json)
- [`../examples/standalone.local.profile.jsonc`](../examples/standalone.local.profile.jsonc)
- [`../examples/standalone.live.profile.jsonc`](../examples/standalone.live.profile.jsonc)

Pre-seed auth state with the bundled helper if you want to avoid logging in during the first run:

```bash
pnpm exec dramaturge-auth-state \
  --url http://localhost:3000/login \
  --output ./.dramaturge-state/user.json \
  --success-url http://localhost:3000/
```

Then run the probe:

```bash
pnpm exec dramaturge --config ./dramaturge.config.json
```

## Source-aware integration remains optional

If you want source-aware hints after extraction, point `repoContext.root` at the app repository you want Dramaturge to inspect. That path is resolved relative to the config file, not the current shell working directory.

```jsonc
"repoContext": {
  "root": "/absolute/path/to/your-app",
  "framework": "nextjs"
}
```

## Publish to GitHub Packages

This package is already scoped for your personal namespace as `@aram10/dramaturge`.

1. Keep `publishConfig.registry` set to `https://npm.pkg.github.com`.
2. Configure GitHub Packages auth with a local `.npmrc` entry for `@aram10:registry=https://npm.pkg.github.com`.
3. Package metadata already points at `https://github.com/aram10/dramaturge`.
4. Run `pnpm pack` and `pnpm run verify:standalone`.
5. Push the extracted repository with the bundled workflow at [`.github/workflows/publish.yml`](../.github/workflows/publish.yml).
