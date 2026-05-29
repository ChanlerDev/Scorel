# S0020: Remote WebSocket Server

## Goal

Implement the daemon-side WebSocket server primitive needed for remote control.

This spec proves that a daemon can accept authenticated remote clients over WebSocket and route the existing protocol messages without changing session ownership.

## Scope

- Add a daemon-owned WebSocket server primitive for remote connections.
- Reuse the same protocol message model used by embedded and local socket transports.
- Validate token auth during connection setup or the first protocol handshake, according to S0019.
- Route connect, ping, request/response, subscribe, event broadcast, disconnect, and error messages through the daemon boundary.
- Keep daemon as the only session writer and runtime holder.
- Add tests for auth success, auth failure, malformed messages, clean close, event delivery, and request/response behavior.
- Use the same WebSocket server primitive in tests and product commands; do not add test-only transports or protocol shortcuts.

## Not In Scope

- Browser/client `WsTransport` implementation.
- CLI remote attach UX.
- TLS termination or certificate management.
- HTTP REST API.
- Supervisor, auto-restart, daemon install service, or process manager.
- Public network hardening beyond token validation and predictable error handling.

## Acceptance Criteria

- A daemon WebSocket server can start on an injected host/port in tests and close cleanly.
- An authenticated remote connection can connect to a session and receive `connected`.
- Invalid token connections are rejected with a structured error and do not attach to a session.
- Ping/pong and at least one daemon request/response path work over WebSocket.
- Session events generated inside the daemon are broadcast to authenticated WebSocket clients subscribed to that session.
- Malformed JSON or unknown message types return clear errors without crashing the server.
- Package boundary tests still enforce `@scorel/daemon` does not depend on `@scorel/client` or `apps/*`.

## Tests

- `pnpm --filter @scorel/daemon test`
- `pnpm --filter @scorel/protocol test`
- `pnpm typecheck && pnpm test`

## Affected Paths

- `packages/daemon/src/`
- `packages/protocol/src/`
- `docs/spec/daemon.md`
- `docs/ROADMAP.md`

## Risks And Boundaries

- WebSocket server code can accidentally become an app-level daemon lifecycle. Keep this as a reusable primitive; product commands belong in S0022.
- Avoid daemon-to-client package dependencies. The server consumes protocol messages, not `DaemonClient`.
- Do not claim remote production security in this spec. Token auth is the M4 minimum; TLS and deployment hardening remain separate product work.
- Do not introduce mock server behavior that differs from the product server path.
