# S0021: Remote WebSocket Client Transport

## Goal

Implement the client-side WebSocket transport for remote daemon control.

This spec makes `DaemonClient` able to use a remote WebSocket daemon while preserving the same API used by embedded and local socket modes.

## Scope

- Add a `WsTransport` implementation that satisfies `DaemonTransport`.
- Keep the root `@scorel/client` export browser-safe while exposing remote WebSocket support from the appropriate entrypoint.
- Support token-authenticated connect according to S0019.
- Preserve request/response, event subscription, close, and parse-error behavior.
- Add reconnect-oriented tests that verify a client can reconnect with `lastSeq` and resync missed events when used with the daemon WebSocket server primitive.
- Ensure transport errors map to concise client-visible error messages.
- Use the same `WsTransport` implementation for tests, CLI, and future browser clients; do not add validation-only transport branches.

## Not In Scope

- CLI command UX.
- Daemon WebSocket server implementation beyond consuming the S0020 primitive in tests.
- Token persistence, token prompts, or config file storage.
- Browser UI.
- Background retry policy beyond the minimum needed to prove reconnect/resync semantics.

## Acceptance Criteria

- `WsTransport` can connect to an authenticated daemon WebSocket endpoint and resolve `connect`.
- `DaemonClient` can send a message, receive responses, and subscribe to events over `WsTransport`.
- Closing the WebSocket tears down handlers without leaking subscriptions.
- A reconnect path can provide `lastSeq` and recover missed events in order.
- Browser-safety tests prove root `@scorel/client` does not import Node-only APIs.
- Existing embedded and local socket client tests still pass.

## Tests

- `pnpm --filter @scorel/client test`
- `pnpm --filter @scorel/daemon test`
- `pnpm typecheck && pnpm test`

## Affected Paths

- `packages/client/src/`
- `packages/daemon/src/`
- `packages/protocol/src/`
- `docs/spec/client.md`
- `docs/ROADMAP.md`

## Risks And Boundaries

- Do not fork `DaemonClient` for remote mode. The product value is that deployment mode changes only the transport.
- Node and browser WebSocket implementations may differ. Keep the transport contract small and test behavior rather than implementation details.
- Do not add token storage here; storing secrets is a product UX/security decision for a later spec.
- Do not use fake transports as proof that remote control works.
