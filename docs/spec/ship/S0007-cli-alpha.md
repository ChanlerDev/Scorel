# S0007: CLI Alpha

## Goal

Expose the M1 product experience: `scorel chat` starts the embedded path, streams assistant output, and resumes a persisted local session.

## Deliverable

- `scorel chat` command in `apps/cli`.
- Local session create/resume behavior.
- Prompt input loop for minimal multi-turn chat.
- Streaming assistant output.
- Basic status/error output.
- Fake runtime or fake provider mode for automated tests.

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

- `pnpm --filter @scorel/cli test`
- End-to-end test runs CLI against fake runtime/provider and verifies multi-turn persistence.
- Manual smoke test with a real provider may be documented, but CI must not require API credentials.
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
- Depending on real provider credentials for validation will make M1 hard to reproduce. Keep fake-provider tests first.
