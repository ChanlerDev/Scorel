# S0007: CLI Alpha

## Goal

Expose the M1 product experience: `scorel chat` starts the embedded path, streams assistant output, and resumes a persisted local session.

## Deliverable

- `scorel chat` command in `apps/cli`.
- Local session create/resume behavior.
- Prompt input loop for minimal multi-turn chat.
- Streaming assistant output.
- Basic status/error output.
- Real provider runtime path for manual/product validation.

## Success Criteria

- A user can run `scorel chat`, send multiple prompts, see assistant output, exit, and continue the same session.
- CLI uses `@scorel/client` plus embedded daemon wiring; it does not call runtime/session directly.
- Session files are written through daemon-owned persistence.
- The CLI remains simple enough to replace with TUI/WebUI later without moving domain logic into the app.

## Boundaries

- No slash command suite.
- No remote `attach`.
- No standalone daemon command behavior beyond entrypoint shell if already created.
- No checkpoint, rewind, compact, permission, MCP management, or GUI.
- No polished TUI. Plain terminal interaction is enough.

## Verification

- `pnpm --filter @scorel/app-cli test`
- End-to-end validation runs CLI against a real provider and verifies multi-turn persistence.
- `pnpm -r typecheck`
- `pnpm -r test`

## Affected Paths

- `apps/cli/`
- `packages/client/`
- `packages/daemon/`
- `packages/core/`
- `packages/protocol/`

## Risks

- Putting UX shortcuts directly into CLI can bypass daemon/client and invalidate the architecture.
- Mock-only validation can make the CLI look complete while no real model can run. Keep deterministic unit coverage, but product completion requires real-provider validation.
