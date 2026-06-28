# S0113: Daemon Attach Lifetime

## Goal

Make local daemon lifetime match the product model: normal CLI/GUI clients attach to one local daemon, and an attach-owned daemon exits as soon as the last client disconnects. Only explicitly user-started daemon commands may remain alive with zero clients.

Business value: Scorel should not leave invisible helper daemons running after the user closes every entrypoint. At the same time, an explicit host start command means the user asked for a background service, so that daemon must remain available until stopped.

## Scope

- Replace the old helper-daemon idle policy with connection ownership:
  - attach-owned daemons exit immediately when connected client count becomes zero;
  - no 15 minute grace period for GUI/CLI auto-start daemons;
  - active IM extensions do not keep an attach-owned daemon alive after all clients disconnect.
- Keep one local daemon singleton:
  - CLI and GUI first read `~/.scorel/daemon.json`;
  - if the recorded daemon is alive, they attach to it;
  - if it is missing or stale, they start one local singleton daemon and attach.
- Distinguish daemon launch intent:
  - `attached`: daemon was auto-started so a CLI/GUI client could attach; it is owned by live connections;
  - `user_started`: daemon was started by an explicit user command and may stay alive without clients.
- Treat these as `user_started`:
  - `scorel host start`;
  - foreground `scorel host serve`.
- Treat GUI auto-start, ordinary CLI attach/run auto-start, and WebUI convenience flows as `attached` unless they attach to an already user-started daemon.
- Persist enough launch intent in daemon state or startup options for status, tests, and shutdown decisions to be deterministic.
- Update docs so product wording no longer says helper daemons wait 15 minutes or active IM keeps them alive.

## Not In Scope

- Adding a system LaunchAgent, login item, or crash-restart supervisor.
- Changing remote daemon lifecycle.
- Changing Relay pairing, remote project, or hosted WebUI semantics.
- Migrating historical `daemon.json` files. Scorel is pre-1.0; stale local daemon state may be deleted or rewritten by the new lifecycle implementation.
- Keeping active IM as a lifecycle exception for attach-owned daemons.
- Adding per-client UI for daemon ownership.

## Product Semantics

Normal app use is attach-based. If GUI and CLI are both connected, closing CLI only removes one client and the daemon remains alive for GUI. When GUI also closes, connected client count becomes zero and the attach-owned daemon exits immediately.

Manual daemon use is service-based. If the user runs `scorel host start`, the daemon is allowed to have zero clients because the command explicitly started a background Host. It stops through `scorel host stop`, process exit/crash, or machine shutdown.

Foreground daemon use is terminal-owned. If the user runs `scorel host serve`, the foreground process maintains liveness until Ctrl-C/SIGTERM, regardless of whether any client is attached.

IM configuration is not a keepalive signal. IM can create sessions while the daemon is alive, but it must not turn a helper daemon into a permanent background process after all clients disconnect.

## Acceptance Criteria

- With one GUI client and one CLI client attached to an attach-owned daemon, CLI exit does not stop the daemon while GUI is still connected.
- When the final GUI/CLI client disconnects from an attach-owned daemon, the daemon shuts down immediately without waiting for an idle timeout.
- Active IM configuration does not prevent that final-client shutdown.
- `scorel host start` starts or reuses a `user_started` daemon that remains alive with zero clients.
- `scorel host serve` remains alive with zero clients until Ctrl-C/SIGTERM, because the foreground terminal command owns its lifetime.
- WebUI convenience flows do not make a daemon user-started by themselves; they either attach to an existing user-started daemon or start an attach-owned daemon.
- GUI auto-start still attaches to an existing user-started daemon instead of spawning a second daemon.
- GUI auto-start with no live daemon starts an attach-owned daemon and that daemon exits after GUI closes if no other clients remain.
- `scorel host status` exposes enough information to tell whether the daemon is `attached` or `user_started`.
- Documentation no longer describes helper daemon lifetime as "15 minute idle timeout" or "active IM keepalive".

## Test Requirements

```bash
pnpm --filter @scorel/app-cli test -- src/daemon-cli.test.ts src/up-cli.test.ts
pnpm --filter @scorel/app-gui test -- src/main/local-host.test.ts
pnpm --filter @scorel/daemon test -- src/embedded/embedded.test.ts
pnpm typecheck
pnpm test
```

Targeted tests must cover:

- daemon launch intent parsing and state persistence;
- immediate final-client shutdown for attach-owned daemons;
- multiple clients where shutdown waits for the last disconnect;
- active IM not preventing attach-owned final-client shutdown;
- `host start` / `host serve` zero-client keepalive;
- GUI auto-start passing attach-owned launch intent;
- status output for launch intent.

Manual/E2E:

- Start GUI from a clean temp HOME, confirm a singleton daemon starts, close GUI, and verify the daemon exits.
- Start GUI, attach a CLI client, close CLI, verify daemon remains alive, then close GUI and verify daemon exits.
- Run `scorel host start`, verify the daemon remains alive with no attached clients, then stop it with `scorel host stop`.
- Run a WebUI convenience flow with no existing daemon, close the client, and verify any auto-started attach-owned daemon exits after the last client disconnects.

## Impacted Files

- `apps/cli/src/daemon-cli.ts`
- `apps/cli/src/daemon-cli.test.ts`
- `apps/cli/src/up-cli.ts`
- `apps/cli/src/up-cli.test.ts`
- `apps/gui/src/main.ts`
- `apps/gui/src/main/host-launcher.ts`
- `apps/gui/src/main/host-launcher.test.ts`
- `apps/gui/src/main/local-host.ts`
- `apps/gui/src/main/local-host.test.ts`
- `packages/daemon/src/index.ts`
- `packages/daemon/src/embedded/embedded.test.ts`
- `docs/SHIP.md`
- `docs/ROADMAP.md`

## Risks And Boundaries

- Client disconnect detection must be based on real transport connection lifecycle, not command names or UI assumptions.
- The shutdown path must avoid double-closing active WebSocket connections or marking `daemon.json` stopped before the process is actually exiting.
- A daemon started by GUI auto-start must not accidentally inherit user-started defaults from `host start`.
- WebUI convenience flows must be explicit in tests because they can start a daemon, but they must not accidentally become the manual keepalive exception.
- Because Scorel is pre-1.0, prefer changing the daemon state schema directly over adding compatibility aliases for old lifecycle fields.

## Status

Done.
