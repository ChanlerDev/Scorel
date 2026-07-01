# AGENTS.md

## Cursor Cloud specific instructions

Scorel is a pnpm (v11.1.2) TypeScript monorepo for an AI agent platform. Packages
live under `packages/*` (`protocol`, `core`, `daemon`, `client`) and entry apps
under `apps/*` (`cli`, `webui`, `gui`, `relay`). The Host owns Project/Session/
Runtime; CLI, WebUI and GUI are only entries that talk to it via `@scorel/client`.

### Node version (non-obvious)
`package.json` requires Node `>=22.19.0`. A fresh login shell resolves the nvm
default (`v22.22.2`, satisfies the engine). If you ever see `node` reporting an
older `v22.14.0`, an `/exec-daemon/node` shim is shadowing nvm on `PATH`; run
`nvm use 22` (or prepend `/home/ubuntu/.nvm/versions/node/v22.22.2/bin`) before
running tools. `engine-strict` is off, so `pnpm install` still succeeds either way.
`rg` (ripgrep) must be on PATH — the `Glob`/`Grep` agent tools shell out to it.

### Lint / test / build
- Lint-equivalent + tests (the project "check"): `pnpm typecheck` then `pnpm test`
  (also exposed as `pnpm check`). There is no ESLint/Biome; `pnpm typecheck` runs
  `tsc --noEmit` across all workspaces.
- WebUI build: `pnpm --filter @scorel/app-webui build` (Next.js 14).

### Running the app (dev)
- CLI interactive agent: `pnpm scorel` (or `pnpm scorel run --prompt "..."` headless).
- Host + local WebUI together: `pnpm scorel up --cwd <project-dir>` → Host at
  `ws://127.0.0.1:7777`, WebUI at `http://127.0.0.1:3000`. The WebUI Settings page
  auto-detects the local Host from `~/.scorel/daemon.json` ("Detected local daemon"
  → "Use this device"); no manual token entry needed on the same machine.
- WebUI only: `pnpm --filter @scorel/app-webui dev`.
- GUI (`pnpm gui`) is an Electron desktop shell and needs a display; prefer CLI/WebUI
  for headless verification.

### Model provider is required for agent turns (non-obvious)
Starting the Host/WebUI needs no credentials, but actually sending a chat turn needs
a model configured in `~/.scorel/config.toml` (providers → provider_models →
available_models → model_profile.roles), or `scorel run` provider overrides
(`--provider --api openai-completions --base-url <url> --api-key <key> --model <id>`).
Without a provider/key, turns fail with a provider error.

To exercise the full agent loop end-to-end without external credentials, point a
custom `openai-completions` provider at a local mock OpenAI-compatible SSE server
(implement `POST /v1/chat/completions` returning ChatCompletionChunk SSE frames).
This is how the environment was validated: a mock returning a `Bash` tool call drove
a real tool execution, tool result, and final assistant message, all persisted to
the session JSONL.

### Session storage
Sessions are append-only JSONL under `~/.scorel/sessions/<sessionId>.jsonl` (the Host
is the only writer). This directory is the source of truth for replay/resume.
