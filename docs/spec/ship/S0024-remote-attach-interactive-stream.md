# S0024: Remote Attach Interactive Stream

## Goal

Fix `scorel attach` so remote attached clients behave like live session viewers, not only prompt senders.

Multiple attached clients must see the same session event stream, and a client that reconnects while a turn is still running must receive subsequent streamed events without sending another prompt.

## Scope

- Keep `scorel attach --remote` connected to the session event stream for the whole interactive process.
- Render text deltas, tool results, and daemon errors from any client attached to the same session.
- Remove the send-only temporary subscription behavior from attach.
- Keep local socket attach and remote attach on the same interactive attach code path.
- Add tests that start a real WebSocket server and verify a passive remote attach client receives session events without sending a prompt.
- Verify the behavior with real daemon/client processes.

## Not In Scope

- Full TUI polish, prompt rendering, scrollback, or terminal layout.
- Persisting per-client `lastSeq` across CLI process restarts.
- Automatic reconnect loop after network failure.
- Reconstructing partial transient deltas that were already emitted before a client connected.
- Cancel/interrupt propagation to stop an in-flight remote turn.

## Acceptance Criteria

- Two remote `scorel attach` clients connected to the same session can both receive streamed events from one client prompt.
- A passive attach client receives future events without sending input.
- Reattaching while the daemon continues a turn receives subsequent events.
- Local attach behavior remains green.
- `pnpm typecheck && pnpm test` passes.

## Tests

- `pnpm --filter @scorel/app-cli test`
- `pnpm typecheck && pnpm test`
- Manual real-process validation: one `scorel-daemon serve` process and two `scorel attach --remote` clients sharing one session.

## Affected Paths

- `apps/cli/src/index.ts`
- `apps/cli/src/index.test.ts`
- `docs/ROADMAP.md`

## Risks And Boundaries

- This does not promise replay of transient text that was emitted before a client connected. Only future events and persistent session recovery are covered.
- Do not add a fake transport or test-only CLI branch. Use the same `DaemonClient` and transport path as the product.
