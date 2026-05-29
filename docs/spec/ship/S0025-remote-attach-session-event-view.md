# S0025: Remote Attach Session Event View

## Goal

Fix `scorel attach` so every attached terminal behaves as a consistent session event view.

User messages, final assistant messages, tool results, and recoverable events must be visible to all attached clients. A reconnect must recover missed persistent session state from the daemon instead of relying only on live transient deltas.

## Scope

- Render `user_message` events in attached terminals so all clients see the same submitted prompts.
- Render missed persistent `assistant_message` and `tool_result` events returned by `load_session` / `resync_events`.
- Keep live `text_delta` rendering for in-flight assistant output.
- Avoid duplicating final assistant text when a client already rendered its live deltas.
- Add terminal line boundary handling so passive clients do not leave the next user input prompt on the same line as assistant output.
- Make explicit `create_session` idempotent enough for concurrent attach clients racing to create the same session id.
- Keep local socket attach and remote WebSocket attach on the same CLI code path.
- Validate with real daemon/client processes and the real provider path.

## Not In Scope

- Byte-for-byte replay of transient text deltas that were emitted before a client connected.
- Automatic network reconnect loop after a socket closes.
- Full TUI/editor prompt management.
- Per-client scrollback preferences.
- Cancel/interrupt propagation.

## Acceptance Criteria

- Two remote `scorel attach` clients connected to one session both display a submitted `user_message`.
- A client that reconnects after a turn completes can display missed persistent assistant output from JSONL-backed daemon state.
- A client that reconnects while a turn is still running recovers persisted events already committed and continues to receive future live events.
- Two clients attaching to the same missing session at the same time do not leave either client stuck waiting for `create_session`.
- Passive terminal output has clean line boundaries between session events and user input.
- `pnpm check` passes.

## Tests

- Add focused CLI tests for persistent event rendering and terminal boundaries.
- Run `pnpm --filter @scorel/app-cli test`.
- Run `pnpm check`.
- Run manual real-process validation with one `scorel-daemon serve` process and two `scorel attach --remote` clients sharing one session.

## Affected Paths

- `apps/cli/src/index.ts`
- `apps/cli/src/index.test.ts`
- `packages/daemon/src/index.ts`
- `packages/daemon/src/embedded/embedded.test.ts`
- `docs/ROADMAP.md`
- `self/discussions/2026-05-29-m4-remote-control-planning.md`

## Risks And Boundaries

- The reliable recovery source is persistent session JSONL. Transient events remain best-effort live UI events.
- The CLI must not add a hidden test-only mode, fake transport, or fake protocol branch.
- Rendering should be idempotent by event id so reconnect/resync does not duplicate already displayed persistent messages.
