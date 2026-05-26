# S0003: Protocol Contracts

## Goal

Define the minimum cross-package contracts required by M1 so core, daemon, client, and CLI share one protocol language.

## Deliverable

- ID and version primitives: `SessionId`, `EventId`, `ClientId`, `Seq`, `protocolVersion`.
- Message primitives: roles, content blocks, usage, stop reason.
- Persistent event types needed by M1: session header, user message, assistant message, tool result if required by runtime loop.
- Transient event types needed by M1: turn start/end, message start/end, text delta, error.
- Client/daemon request-response envelopes for session create/load/list, send message, status, and event subscription.
- `DaemonTransport` interface shared by client and embedded transport.

## Success Criteria

- M1 packages import protocol types only from `@scorel/protocol`.
- Protocol is browser-safe and has no Node API dependency.
- Request/response correlation is typed and testable.
- Error responses use stable error codes rather than ad hoc thrown strings.
- The protocol is sufficient for S0004-S0007 without introducing duplicate local types.

## Boundaries

- No auth protocol.
- No WebSocket-specific transport behavior.
- No remote reconnect algorithm beyond the presence of `lastSeq` / `Seq` primitives.
- No full rewind, compact, checkpoint, channel, or permission protocol.
- No provider-specific LLM message formats.

## Verification

- `pnpm --filter @scorel/protocol typecheck`
- `pnpm --filter @scorel/protocol test`
- Type tests cover event unions, request/response pairing, and exhaustive event handling.
- A browser-safety test or lint check ensures protocol imports no Node built-ins.

## Affected Paths

- `packages/protocol/`
- `packages/client/`
- `packages/daemon/`
- `packages/core/`

## Risks

- Over-modeling future features will slow M1 and create false stability. Keep contracts to the CLI Alpha path.
- Under-modeling events will force later packages to invent local types. Treat duplicate protocol-like types as a failure.
