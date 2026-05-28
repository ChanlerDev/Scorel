# S0013: Local Daemon Protocol

## Goal

Prepare the protocol and package boundaries needed for M3 local daemon work without starting a real background process yet.

This spec turns the existing embedded-only daemon/client path into a transport-ready contract for local standalone daemon work.

## Scope

- Align `@scorel/protocol` wire types with M3 local daemon needs.
- Define the Node-only socket transport surface as a client subpath contract.
- Keep `@scorel/client` browser-safe at its root export.
- Add tests that protect `@scorel/client` from importing `@scorel/core`, `@scorel/daemon`, or Node-only socket modules through the root export.
- Add daemon-side tests for connect, subscribe, resync, and per-session `lastSeq` behavior through the protocol interface.
- Document any small contract changes in `docs/spec/client.md` or `docs/spec/daemon.md` if the implementation changes public names.

## Not In Scope

- A standalone `scorel daemon start` process.
- Unix socket / named pipe server implementation.
- `scorel attach` command.
- Process discovery files, PID files, or daemon state files.
- Remote WebSocket transport.
- Token persistence or token refresh commands.

## Acceptance Criteria

- `DaemonTransport` remains the only transport interface consumed by `DaemonClient`.
- Root `@scorel/client` export remains browser-safe and has no Node API imports.
- A Node socket transport entrypoint is reserved for local daemon work, without leaking into browser-safe imports.
- `connect`, `subscribe_events`, `resync_events`, `get_status`, and `disconnect` have protocol-level tests covering request/response shape and event delivery expectations.
- Per-session `lastSeq` behavior is tested at the daemon/client boundary.
- Existing embedded daemon/client CLI tests still pass.

## Tests

- `pnpm --filter @scorel/protocol test`
- `pnpm --filter @scorel/client test`
- `pnpm --filter @scorel/daemon test`
- `pnpm typecheck && pnpm test`

## Affected Paths

- `packages/protocol/src/transport.ts`
- `packages/protocol/src/wire.ts`
- `packages/client/src/`
- `packages/daemon/src/`
- `docs/spec/client.md`
- `docs/spec/daemon.md`
- `docs/ROADMAP.md`

## Risks And Boundaries

- If the socket contract is overfit to Unix sockets, Windows named pipe support will be harder later. Keep the protocol interface transport-neutral.
- If Node-only code leaks through `@scorel/client`, WebUI support will be compromised. Protect this with package boundary tests.
- Do not add remote auth or WebSocket behavior here; M3 is local daemon only.
