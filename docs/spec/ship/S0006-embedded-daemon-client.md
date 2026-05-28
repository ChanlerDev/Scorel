# S0006: Embedded Daemon + Client

## Goal

Close the internal M1 control loop by connecting DaemonClient to an embedded daemon that owns session writes, runtime execution, and event broadcast.

## Deliverable

- Embedded daemon lifecycle.
- `RuntimeBridge` that converts raw runtime events into protocol events.
- `SessionLane` that serializes writes for one session.
- `EventBroadcaster` for connected clients.
- `DaemonClient` request/response handling and local UI state projection.
- In-process embedded transport for CLI Alpha.

## Success Criteria

- `DaemonClient.sendMessage()` causes daemon to append the user event, execute runtime, persist assistant output, and broadcast events.
- Daemon is the only writer to session storage in this path.
- Embedded daemon accepts `sessionsDir`, the directory that directly stores session JSONL files. The product default is fixed at `~/.scorel/sessions`; tests and debugging may pass an explicit directory.
- Client receives transient streaming events and final persistent events.
- Multiple embedded clients can subscribe to the same session in-process for tests.
- CLI-facing code never imports runtime/session directly.

## Boundaries

- No Unix socket or WebSocket transport.
- No auth.
- No process-level daemon service.
- No remote reconnect beyond in-memory `lastSeq` basics needed by the client reducer.
- No channel manager.

## Verification

- `pnpm --filter @scorel/daemon test`
- `pnpm --filter @scorel/client test`
- Integration test: client sends a message, daemon writes JSONL, runtime emits stream, client receives ordered events.
- Boundary test confirms `@scorel/client` does not depend on `@scorel/core` or `@scorel/daemon`.
- `pnpm -r typecheck`

## Affected Paths

- `packages/daemon/`
- `packages/client/`
- `packages/core/`
- `packages/protocol/`

## Risks

- If embedded transport leaks daemon internals into `@scorel/client`, WebUI/browser support will be compromised.
- If SessionLane is skipped for M1, later multi-client behavior will need a painful rewrite.
