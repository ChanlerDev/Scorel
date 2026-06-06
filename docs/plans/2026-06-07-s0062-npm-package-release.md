# S0062 Npm Package Release Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build one public `scorel` npm package and add local/CI release commands aligned with `docs/SHIP.md`.

**Architecture:** The root package is the only public npm package. `esbuild` bundles `apps/cli/src/index.ts` plus internal workspace packages into `dist/index.js`; WebUI remains a separate Vercel monorepo build. `scripts/release.mjs` is the single release orchestrator for both local use and GitHub Actions.

**Tech Stack:** Node.js 22, pnpm 11.1.2, esbuild, npm pack/publish, GitHub Actions `workflow_dispatch`.

---

### Task 1: Formalize S0062 Contract

**Files:**
- Create: `docs/spec/ship/S0062-npm-package-and-release-workflow.md`
- Create: `docs/plans/2026-06-07-s0062-npm-package-release.md`
- Modify: `docs/ROADMAP.md`
- Modify: `docs/CHANGELOG.md`

**Steps:**

1. Add the S0062 spec with goal, scope, non-goals, release contract, acceptance criteria, tests, affected paths, and risks.
2. Add this implementation plan.
3. Add S0062 to the M8 follow-up roadmap section and Active Specs.
4. Add an Unreleased changelog entry for release/package infrastructure.

### Task 2: Add Package Build

**Files:**
- Modify: `package.json`
- Create: `scripts/build-package.mjs`

**Steps:**

1. Add root package fields: `bin`, `files`, `license`, `repository`, and publish config.
2. Add `build:package` script.
3. Implement `scripts/build-package.mjs` using esbuild to bundle `apps/cli/src/index.ts` to `dist/index.js`.
4. Make `dist/index.js` executable.
5. Verify with `pnpm build:package && node dist/index.js --help`.

### Task 3: Add Pack Smoke

**Files:**
- Modify: `package.json`
- Create: `scripts/pack-smoke.mjs`

**Steps:**

1. Add `pack:smoke` script.
2. Implement `npm pack --json` in a temporary directory.
3. Install the tarball into a temporary project.
4. Run `scorel --help` from the temporary project.
5. Verify with `pnpm pack:smoke`.

### Task 4: Add Release Script

**Files:**
- Modify: `package.json`
- Create: `scripts/release.mjs`

**Steps:**

1. Add `release` script.
2. Parse `patch|minor|major`, `--dry-run`, and `--no-publish`.
3. Require clean git state at start.
4. Run `pnpm typecheck`, `pnpm test`, `pnpm --filter @scorel/app-webui build`, `pnpm build:package`, and `pnpm pack:smoke`.
5. In dry-run, print the next version and exit without mutating git or npm.
6. In real mode, bump lockstep package versions, update changelog, rebuild, commit `release: vX.Y.Z`, tag `vX.Y.Z`, and publish unless `--no-publish`.
7. Verify with `pnpm release patch --dry-run`.

### Task 5: Add Manual GitHub Actions Workflow

**Files:**
- Create: `.github/workflows/release.yml`

**Steps:**

1. Add a `workflow_dispatch` workflow with `bump`, `dry_run`, and `publish` inputs.
2. Set up Node 22 and pnpm 11.1.2.
3. Install with `pnpm install --frozen-lockfile`.
4. Run `pnpm release <bump> --dry-run` by default.
5. For real publish, configure npm auth from `NPM_TOKEN` and run `pnpm release <bump>`.

### Task 6: Verify

**Commands:**

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

Expected: all commands pass.
