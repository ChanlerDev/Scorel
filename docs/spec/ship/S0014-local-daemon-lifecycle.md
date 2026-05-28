# S0014: Local Daemon Lifecycle

## Goal

Implement a local standalone daemon process that can be started, discovered, and stopped independently from `scorel chat`.

This spec establishes the process and lifecycle foundation for multiple local clients to share one daemon.

## Scope

- Implement a Node local server transport for the daemon side using Unix socket on macOS/Linux and a clear named-pipe-compatible abstraction boundary.
- Implement the matching Node socket transport entrypoint for `@scorel/client/node`.
- Add `scorel daemon start`, `scorel daemon status`, and `scorel daemon stop` command behavior.
- Persist local daemon connection state under Scorel-owned product state, including socket path, pid, started time, local token, and connection metadata.
- Keep `~/.scorel` and `~/.scorel/sessions` as fixed product paths, not user-exposed config flags.
- Ensure clean shutdown closes the socket and removes stale state when possible.
- Return clear errors for stale socket/state files and unavailable daemon processes.

## Not In Scope

- `scorel attach` interactive UX.
- Multi-client broadcast smoke.
- Remote WebSocket daemon.
- Token refresh UX, remote token distribution, or permission tiers.
- Crash recovery supervisor, auto-restart, launchd/systemd integration, Docker service.
- Channel manager, GUI, WebUI, or IM integration.

## Acceptance Criteria

- `scorel daemon start` starts a local daemon process that remains alive independently of the invoking client until stopped or signaled.
- `scorel daemon status` reports whether a local daemon is reachable and includes pid/socket/session count when available.
- `scorel daemon stop` gracefully shuts down the local daemon and cleans up local connection state.
- A second start command detects an already-running daemon instead of starting a duplicate.
- Stale state is detected and reported with an actionable error.
- Local socket connections validate the stored local token or an equivalent local-only connection secret.
- Socket transport tests cover successful connect, ping/pong, clean close, and connection failure.
- Package boundary tests still enforce `@scorel/daemon` does not depend on `@scorel/client` or `apps/*`.

## Tests

- `pnpm --filter @scorel/client test`
- `pnpm --filter @scorel/daemon test`
- `pnpm --filter @scorel/app-daemon test`
- `pnpm --filter @scorel/app-cli test`
- `pnpm typecheck && pnpm test`

## Affected Paths

- `packages/client/src/`
- `packages/daemon/src/`
- `apps/daemon/src/index.ts`
- `apps/daemon/src/index.test.ts`
- `apps/cli/src/index.ts`
- `apps/cli/src/index.test.ts`
- `docs/spec/daemon.md`
- `docs/spec/client.md`
- `docs/ROADMAP.md`

## Risks And Boundaries

- A daemon process manager can grow into a supervisor. Keep this spec to explicit start/status/stop.
- Cross-platform socket details can pollute protocol code. Keep transport implementation behind Node-only entrypoints.
- Do not make product paths configurable just to simplify tests; tests can inject temporary paths through internal APIs.
