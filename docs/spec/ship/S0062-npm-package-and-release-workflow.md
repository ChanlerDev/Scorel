# S0062: Npm Package And Release Workflow

## Goal

Make the first public npm release path executable:

```text
pnpm release patch --dry-run
pnpm release patch
```

The public package is one user-facing package named `@chanlerdev/scorel`. It installs the `scorel` CLI command and includes the CLI, local Host/daemon runtime, pairing command, and Relay operator command. Internal workspace packages remain unpublished for now.

## Scope

- Publish surface:
  - root package name: `@chanlerdev/scorel`
  - bin: `scorel`
  - first version: `0.0.1`
- Add package build:
  - bundle `apps/cli/src/index.ts` to `dist/index.js`
  - keep the generated bin executable
  - do not require `tsx` at runtime
- Add local release command:
  - `pnpm release patch`
  - `pnpm release minor`
  - `pnpm release major`
  - `--dry-run` validates without committing, tagging, pushing, or publishing
  - `--no-publish` commits/tags without npm publish
- Add npm pack smoke:
  - pack the root package
  - install it into a temporary project
  - run `scorel --help`
- Add manual GitHub Actions release workflow:
  - `workflow_dispatch`
  - default `bump=patch`
  - default `dry_run=true`
  - uses the same `pnpm release` command
- Update docs/roadmap/changelog for release readiness.

## Non-Goals

- Do not publish `@scorel/protocol`, `@scorel/client`, `@scorel/core`, `@scorel/daemon`, `@scorel/app-cli`, or `@scorel/relay`.
- Do not bundle hosted WebUI into the npm package.
- Do not change hosted WebUI deployment. It remains a Vercel/monorepo build.
- Do not implement accounts, OAuth, or hosted execution.
- Do not automatically publish from CI unless the workflow is manually triggered with `dry_run=false`.

## Contract

### Package Build

```bash
pnpm build:package
```

must create:

```text
dist/index.js
```

The generated file must:

- start with a node shebang
- be executable
- run without `tsx`
- include internal workspace code needed by the CLI/Host/Relay commands

### Release Command

```bash
pnpm release patch --dry-run
```

must:

- require a clean working tree, except generated release artifacts it creates during the run
- run repo checks
- build WebUI
- build the npm package
- run npm pack smoke
- compute the next version
- report what would happen
- not mutate package versions, changelog, git commit, git tag, push, or publish

```bash
pnpm release patch
```

must:

- require clean working tree
- run the same verification path
- bump all package/app versions in lockstep
- update `docs/CHANGELOG.md`
- build the npm package
- run npm pack smoke
- commit `release: vX.Y.Z`
- tag `vX.Y.Z`
- publish the root `@chanlerdev/scorel` package to npm

The release script may support `--no-publish` for preparing a release commit/tag without publishing.

### GitHub Actions

Manual workflow inputs:

```text
bump: patch | minor | major
dry_run: true | false
publish: true | false
```

The workflow must:

- install pnpm from `packageManager`
- install system tools required by the release check path, including `ripgrep` for the `Glob` and `Grep` coding-tool tests
- run `pnpm install --frozen-lockfile`
- run `pnpm release <bump> --dry-run` by default
- require `NPM_TOKEN` only for a real publish

## Acceptance Criteria

- Root `package.json` is a publishable `@chanlerdev/scorel` package with `bin`, `files`, `engines`, and release/build scripts.
- `pnpm build:package` creates an executable `dist/index.js`.
- `node dist/index.js --help` works.
- `pnpm pack:smoke` packs and installs the tarball into a temporary project, then runs `scorel --help`.
- `pnpm release patch --dry-run` runs the full dry-run path and exits 0.
- `.github/workflows/release.yml` exists and manually triggers the same release command.
- `.github/workflows/release.yml` installs `ripgrep` before running the release command, so the repo-level test suite matches the product's rg-backed coding tools.
- `docs/ROADMAP.md` includes S0062 as Done only after verification.
- `docs/CHANGELOG.md` records release infrastructure under Unreleased until the first release moves it to a version section.

## Test Requirements

Run:

```bash
pnpm build:package
node dist/index.js --help
pnpm pack:smoke
pnpm release patch --dry-run
pnpm typecheck
pnpm test
pnpm --filter @scorel/app-webui build
git diff --check
```

## Affected Paths

- `package.json`
- `scripts/build-package.mjs`
- `scripts/pack-smoke.mjs`
- `scripts/release.mjs`
- `.github/workflows/release.yml`
- `docs/SHIP.md`
- `docs/ROADMAP.md`
- `docs/CHANGELOG.md`
- `docs/spec/ship/S0062-npm-package-and-release-workflow.md`
- `docs/plans/2026-06-07-s0062-npm-package-release.md`

## Risks

- Bundling can accidentally include development-only code. Keep `files` restricted to `dist`, README, and selected docs.
- Publishing internal packages too early would create API stability pressure. Keep only root `@chanlerdev/scorel` public in S0062.
- Real npm publish requires `chanlerdev` authentication locally or `NPM_TOKEN` in GitHub Actions.
- GitHub hosted runners do not guarantee `rg` is available. Install `ripgrep` explicitly in release workflow setup instead of skipping the rg-backed tool tests.
- A release script that mutates versions before verification can leave the repo dirty after failures. Run verification before mutation for normal release, and keep dry-run non-mutating.
