# Scorel Symphony

TypeScript/Node.js implementation of the [Symphony spec](https://github.com/openai/symphony/blob/main/SPEC.md).

## Current scope

- `WORKFLOW.md` loading with YAML front matter and strict Liquid prompt rendering
- Typed runtime config with env indirection and defaults
- Linear tracker polling and issue normalization
- Per-issue workspace management with lifecycle hooks
- Codex app-server stdio client with startup handshake and turn streaming
- In-memory orchestrator with polling, reconciliation, retries, and workspace cleanup
- Structured JSON logging
- Workflow hot reload
- Optional HTTP dashboard and JSON API

## Trust posture

This implementation currently uses a high-trust default:

- `codex.approval_policy: never`
- `codex.thread_sandbox: danger-full-access`
- unsupported dynamic tools are rejected
- user-input-required turns fail the run

If that is too permissive for your environment, tighten the Codex settings in `WORKFLOW.md`.

## Run

```bash
npm install
npm run build
LINEAR_API_KEY=... node dist/cli.js ./WORKFLOW.md
```

With dashboard/API:

```bash
LINEAR_API_KEY=... node dist/cli.js ./WORKFLOW.md --port 4000
```

Available routes:

- `GET /`
- `GET /api/v1/state`
- `GET /api/v1/:issue_identifier`
- `POST /api/v1/refresh`

## Dev

```bash
npm run check
npm test
```

Real Linear smoke test:

```bash
LINEAR_API_KEY=... LINEAR_PROJECT_SLUG=... npm run test:integration
```

## Prosel Bootstrap

Current default workflow is wired to the Linear project `Prosel: The Prose System`.

Expected local setup:

```bash
export LINEAR_API_KEY=...
export PROSEL_GIT_REMOTE=git@github.com:ChanlerDev/Prosel.git
export PROSEL_GIT_BRANCH=main
export SCOREL_ROOT=/Users/chanler/Scorel
```

Notes:

- Issue workspaces are created under `~/Prosel/.scorel/workspaces`.
- Before each run, Scorel syncs from the Prosel git remote into the issue workspace.
- Default dispatch gating is intentionally strict: only `In Progress` issues are eligible to run.
- Default concurrency for Prosel is `1`, so creating a batch of issues will not trigger parallel execution until you explicitly move one issue into `In Progress`.
- If a workspace has uncommitted changes or local commits ahead of `origin/main`, bootstrap preserves that state instead of resetting it.
