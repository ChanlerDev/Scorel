# S0019: Remote Transport Contract

## Goal

Lock the M4 remote control contract before implementing a WebSocket server.

This spec defines how a local client connects to a remote daemon, how token auth is represented, and how remote reconnect/resync must preserve the same session semantics proven in M3.

## Scope

- Define the remote transport shape for `DaemonTransport`, including WebSocket URL fields, token auth fields, connection metadata, and error categories.
- Align `@scorel/protocol` wire types with remote connection needs without breaking embedded or local socket transports.
- Decide the product-facing CLI shape for remote endpoints, such as `scorel attach --remote <url> --token <token> --session <id>` or an equivalent explicit form.
- Document which remote connection state may be stored locally and which secrets must not be written without an explicit product decision.
- Specify reconnect behavior: client keeps `lastSeq`, reconnects to the same session, calls resync, and receives ordered missed events.
- Add protocol/client/daemon documentation updates where public names or semantics change.
- Define validation expectations around real product paths: M4 completion cannot depend on mock/fake providers, fake transports, or test-only protocol branches.

## Not In Scope

- Implementing the actual WebSocket server.
- Implementing the actual WebSocket client transport.
- TLS certificate automation, OAuth, account login, token rotation, or permission tiers.
- Public relay service, tunnel service, NAT traversal, or cloud-hosted control plane.
- WebUI / GUI.
- Changing embedded or local socket behavior beyond shared protocol types.

## Acceptance Criteria

- `docs/spec/daemon.md` describes remote WebSocket transport, token auth, reconnect, and resync boundaries.
- `docs/spec/client.md` describes WebSocket transport selection, connection state, and remote error handling expectations.
- `@scorel/protocol` exposes any new remote-safe wire types needed by later S specs.
- Remote auth failures, protocol version mismatch, connection loss, and resync failure have concise error categories.
- The CLI UX for remote attach/serve is documented enough for S0022 to implement without redesigning command names.
- Existing embedded and local socket tests still pass.

## Tests

- `pnpm --filter @scorel/protocol test`
- `pnpm --filter @scorel/client test`
- `pnpm --filter @scorel/daemon test`
- `pnpm typecheck && pnpm test`

## Affected Paths

- `packages/protocol/src/`
- `packages/client/src/`
- `packages/daemon/src/`
- `docs/spec/daemon.md`
- `docs/spec/client.md`
- `docs/ROADMAP.md`

## Risks And Boundaries

- If M4 starts by writing WebSocket code without a contract, remote UX and auth semantics will drift across packages.
- If token auth is overbuilt now, M4 will become an account system instead of a remote control milestone. Use bearer-token style auth only.
- Do not expose secrets in logs, session JSONL, or ordinary status output.
- Keep remote transport behavior compatible with the existing `DaemonClient` abstraction; entry apps should not branch into a separate remote client implementation.
- Avoid special validation-only behavior. Tests may exercise the same code path with temporary real resources, but should not add alternate product behavior just to pass tests.
