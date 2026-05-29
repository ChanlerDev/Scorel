# S0022: Remote Daemon CLI Lifecycle

## Goal

Expose the remote daemon and remote attach product entrypoints through CLI commands.

This spec turns the WebSocket primitives from S0020/S0021 into a user-visible remote control path.

## Scope

- Add a remote serve command for the daemon app, such as `scorel-daemon serve --host <host> --port <port> --token <token>`.
- Add or extend CLI attach so a local client can connect to a remote daemon endpoint with an explicit session id and token.
- Keep local attach behavior intact.
- Ensure status/help output clearly distinguishes embedded chat, local daemon, and remote daemon paths.
- Avoid writing tokens to disk by default; if a token is printed or accepted as an argument, redact it from ordinary status and error output.
- Add CLI tests for serve argument validation, remote attach construction, missing token, missing endpoint, and connection failure.
- Keep tests on the same CLI command construction and connection path users will run; do not add hidden validation-only flags.

## Not In Scope

- TLS certificate generation.
- Long-running service installation through launchd/systemd/Docker.
- Persistent remote profiles or named remotes.
- WebUI / GUI.
- Full interactive attach polish beyond sending prompts and streaming events needed for M4 end-to-end validation.
- Permission approval, sandbox, or policy prompts.

## Acceptance Criteria

- Daemon app exposes a remote serve command that starts the WebSocket server primitive with host/port/token options.
- CLI remote attach connects through `DaemonClient + WsTransport`, not by directly importing daemon internals.
- Local attach tests remain green and still use `NodeSocketTransport`.
- Missing or invalid remote options return actionable CLI errors.
- Help text documents the minimum command path for remote control.
- Tokens are not printed in normal status output.

## Tests

- `pnpm --filter @scorel/app-daemon test`
- `pnpm --filter @scorel/app-cli test`
- `pnpm --filter @scorel/client test`
- `pnpm --filter @scorel/daemon test`
- `pnpm typecheck && pnpm test`

## Affected Paths

- `apps/daemon/src/index.ts`
- `apps/daemon/src/index.test.ts`
- `apps/cli/src/index.ts`
- `apps/cli/src/index.test.ts`
- `packages/client/src/`
- `packages/daemon/src/`
- `docs/ROADMAP.md`

## Risks And Boundaries

- Command UX can sprawl into remote profile management. Keep M4 to explicit endpoint and token arguments.
- A remote daemon command can be mistaken for production deployment. Keep docs clear: this is the first remote control path, not a hardened service manager.
- Do not make `scorel chat` remote by default. Remote control should remain opt-in until end-to-end validation and security boundaries are proven.
- Do not special-case test endpoints or bypass `DaemonClient + WsTransport` in CLI tests.
