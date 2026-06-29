# S0114: Dev GUI Host Owner

## Goal

Make `pnpm gui` always run the current checkout's development Host before launching Electron GUI, so local GUI testing never attaches to an installed or stale system daemon.

Business value: GUI development must validate the code in the current repository. If an installed daemon is already running, GUI smoke and manual testing can silently exercise old code, making E2E results misleading.

## Scope

- Replace root `pnpm gui` with a repository-owned dev orchestrator.
- Before launching GUI, stop any currently running daemon recorded in `~/.scorel/daemon.json`.
- Start a new attach-owned Host from the current checkout through `pnpm scorel host serve --lifetime attached`.
- Wait until the dev Host writes a ready line and `daemon.json` before launching Electron GUI.
- Launch `pnpm --filter @scorel/app-gui dev` only after the current checkout Host is ready.
- Pass development launcher env into Electron:
  - `SCOREL_CLI_ENTRYPOINT=<repo>/apps/cli/src/index.ts`
  - `SCOREL_NODE_PATH=<current node executable>`
- If GUI fails before attaching, or the dev orchestrator receives SIGINT/SIGTERM, stop the dev Host.
- If the replaced daemon was `launchIntent: "user_started"`, restore it after GUI exits by starting an installed `scorel host start` with the previous host, port, and token.
- Do not restore replaced attach-owned daemons.

## Not In Scope

- Async/background Bash tools.
- Badge UI or GUI status badge changes.
- Packaged GUI lifecycle changes.
- System LaunchAgent/login-item behavior.
- Running installed and checkout daemons side by side.
- Restoring a killed system daemon after development GUI exits.

## Product Semantics

`pnpm gui` is a development command, not a normal user command. It owns the local dev environment setup:

1. stop the daemon currently recorded in `~/.scorel/daemon.json`;
2. start the current checkout's attach-owned Host;
3. launch Electron GUI against that Host;
4. on failure/interruption, clean up the dev Host;
5. restore the previous daemon only when it was user-started.

This keeps `pnpm gui` deterministic without permanently eating a manually started demo. Foreground `host serve` cannot be restored as the same terminal-owned process after it has been killed; restoration uses a background `scorel host start` with the previous connection fields.

## Acceptance Criteria

- Running `pnpm gui` invokes a dev orchestrator script instead of directly invoking `@scorel/app-gui dev`.
- The orchestrator attempts to stop any existing local daemon before starting the dev Host.
- The dev Host is started through current checkout `pnpm scorel host serve --lifetime attached --no-relay`.
- The GUI process starts only after the Host ready line is observed.
- Electron receives env that points Host auto-start fallback to the current checkout CLI entrypoint and Node executable.
- If Host startup fails, GUI is not launched and the script exits non-zero.
- If GUI exits, the script exits with the GUI exit code.
- If the script is interrupted before GUI attaches, it stops the dev Host so no orphan dev daemon remains.
- A previous `user_started` daemon is restored with `scorel host start --host <old-host> --port <old-port> --token <old-token> --no-relay`.
- A previous attach-owned daemon is not restored.
- Existing packaged GUI scripts and release runtime scripts are unchanged.

## Test Requirements

```bash
node --test scripts/dev-gui.test.mjs
pnpm typecheck
pnpm test
```

Targeted tests must cover:

- command planning stops the old daemon before starting a dev Host;
- GUI launch waits for Host readiness;
- GUI env includes current checkout CLI entrypoint and Node executable;
- failed Host startup prevents GUI launch;
- cleanup stops the dev Host on interruption/failure.
- previous `user_started` daemon restoration;
- no restoration for previous attach-owned daemon.

Manual/E2E:

- Start a `user_started` daemon, then run `pnpm gui`; verify the old daemon is stopped and a new `daemon.json` has `launchIntent: "attached"` and a pid from the current checkout Host.
- Close GUI; verify the dev Host exits after GUI disconnects, and the previous user-started daemon is restored with the old host, port, and token.

## Impacted Files

- `package.json`
- `scripts/dev-gui.mjs`
- `scripts/dev-gui.test.mjs`
- `docs/ROADMAP.md`
- `docs/spec/ship/S0114-dev-gui-host-owner.md`

## Risks And Boundaries

- Killing the existing daemon can interrupt active work. This is acceptable only for `pnpm gui`, because it is a development command. User-facing GUI and packaged GUI must not inherit this behavior.
- A foreground `host serve` cannot be restored into its original terminal. The dev orchestrator restores it as a background `host start` when the previous state was `user_started`.
- The orchestrator must use the current checkout's `pnpm scorel`, not `scorel` from PATH.
- The dev Host should remain attach-owned; do not use `host start`, because that would create a user-started daemon that survives zero clients.
- Avoid adding compatibility branches for older daemon state. Scorel is pre-1.0 and this spec intentionally favors deterministic dev behavior.

## Status

Done.
