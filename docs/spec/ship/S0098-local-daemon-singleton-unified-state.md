# S0098: Local Daemon Singleton And Unified State

## Goal

Make the local Scorel Host a single user-level daemon with one local state root, so CLI, GUI, WebUI, IM, and Relay clients attach to the same Project registry, Session JSONL, runtime stats, and config.

## Scope

- Use `~/.scorel` as the only local Host state root:
  - `daemon.json`
  - `projects.json`
  - `sessions/*.jsonl`
  - `runtime-stats.json`
  - `config.toml`
  - `gui-store.json`
- Remove GUI-local Host state ownership:
  - no new `~/.scorel/gui/projects.json`;
  - no new `~/.scorel/gui/sessions`;
  - GUI still has GUI UI state, but it lives at `~/.scorel/gui-store.json`.
- Add `scorel host start`, a background daemon start path that starts the singleton local daemon without tying daemon lifetime to the CLI process that launched it.
- Make local GUI attach to the singleton daemon when available.
- Make local GUI start the singleton daemon in the background when no live daemon exists, then attach to it.
- Make `scorel up` ensure the singleton daemon is running, register the current cwd as a Project, and launch/serve UI without owning daemon lifetime.
- Keep foreground `scorel host serve` for debugging; Ctrl-C on foreground serve still stops that foreground process.
- Daemon lifecycle:
  - daemon is not killed when one client exits;
  - explicit `scorel host stop` stops it;
  - if no IM extensions are active, daemon idle-shuts down after no connected clients and no active work for the configured timeout;
  - if any IM extension is active, daemon remains alive until explicit stop.

## Not In Scope

- Migrating old `~/.scorel/gui/projects.json` or `~/.scorel/gui/sessions` into the unified state. Scorel is pre-1.0; users may remove old GUI-local files manually if needed.
- System LaunchAgent/login-item installation.
- Multi-user or system-wide daemon.
- Remote daemon lifecycle changes.
- Per-session RTK stats breakdown UI.
- Restart-on-crash supervisor.

## Acceptance Criteria

- GUI local Projects and Sessions are created under `~/.scorel/projects.json` and `~/.scorel/sessions`, not under `~/.scorel/gui`.
- `gui-store.json` is stored at `~/.scorel/gui-store.json`.
- `scorel host start` starts or reuses a background singleton daemon and returns without waiting for daemon shutdown.
- `scorel up` reuses an existing running daemon instead of spawning a child daemon that dies with `scorel up`.
- Starting GUI when a daemon is alive attaches to it and does not start a second Host writer.
- Starting GUI when no daemon is alive starts the background singleton daemon, then attaches to it.
- If no clients remain, no work is active, and no IM extension is active, daemon exits after its idle timeout.
- If an IM extension is active, daemon does not idle-exit solely because there are no GUI/CLI clients.
- Model/tool messages remain unchanged: daemon lifecycle and state unification do not alter tool call args or provider tool result context.

## Test Requirements

```bash
pnpm --filter @scorel/app-cli test -- src/daemon-cli.test.ts src/up-cli.test.ts
pnpm --filter @scorel/app-gui test -- src/main/local-host.test.ts
pnpm --filter @scorel/daemon test -- src/embedded/embedded.test.ts
pnpm verify:m9-gui
pnpm typecheck
pnpm test
```

Manual/E2E:

- Start GUI from a clean temp HOME through Electron CDP.
- Verify local Project registration creates `~/.scorel/projects.json`.
- Verify local Session creation creates `~/.scorel/sessions/*.jsonl`.
- Verify no `~/.scorel/gui/projects.json` or `~/.scorel/gui/sessions` is created.
- Verify GUI start from a clean HOME creates `~/.scorel/daemon.json` and attaches to that daemon.
- Verify `scorel host start` returns while `scorel host status` still reports a running daemon.
- Verify `scorel up` exit does not stop the singleton daemon it started.
- Verify short idle timeout stops a daemon with no clients and no active IM.
- Verify active IM prevents idle shutdown.

## Impacted Files

- `apps/cli/src/daemon-cli.ts`
- `apps/cli/src/up-cli.ts`
- `apps/cli/src/index.ts`
- `apps/gui/src/main.ts`
- `apps/gui/src/main/local-host.ts`
- `packages/daemon/src/index.ts`
- `scripts/verify-m9-gui-cdp-e2e.ts`
- `docs/SHIP.md`
- `docs/ROADMAP.md`

## Risks And Boundaries

- Background daemon process management must not leave stale `daemon.json` as a false-positive running daemon.
- The singleton daemon must remain the only local writer for Project and Session files.
- Electron GUI starts the daemon through the CLI entrypoint; packaged builds must provide `SCOREL_CLI_ENTRYPOINT` when the source tree is unavailable.
- Old GUI-local state under `~/.scorel/gui` is intentionally not migrated in this spec.

## Status

Done.
