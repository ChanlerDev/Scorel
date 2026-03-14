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
