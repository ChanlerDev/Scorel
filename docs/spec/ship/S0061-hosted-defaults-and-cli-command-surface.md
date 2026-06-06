# S0061: Hosted Defaults And CLI Command Surface

## Goal

Make the post-M8 user path match the deployed product:

```text
local terminal -> local Scorel Host -> official Relay -> hosted WebUI
```

The CLI should expose product concepts instead of implementation leakage:

- `scorel` is the normal interactive project command, similar to `claude`.
- `scorel host serve` starts this device's local Host and connects it to Relay by default.
- `scorel pair <code>` authorizes the hosted WebUI Entry through the default Relay.
- `scorel relay serve` is only for operating a self-hosted Relay service.

## Current Deployment Baseline

- Hosted WebUI: `https://scorel.channel.dev`
- Relay WebSocket URL: `wss://scorel-relay.channel.dev`

Self-hosted and development flows can override the Relay URL with `SCOREL_RELAY_URL` or `--relay <url>`.

## Scope

- Add first-class hosted defaults:
  - official WebUI origin
  - official Relay URL
  - environment/config override for self-hosted deployments
- Redesign user-facing CLI commands:
  - `scorel` defaults to interactive project execution in `process.cwd()`
  - `scorel chat` remains as an explicit alias for the same interactive mode
  - `scorel host serve` replaces user-facing `scorel daemon serve`
  - `scorel host serve` registers `process.cwd()` as the initial Project by default
  - `scorel host serve` connects outbound to the official Relay by default
  - `scorel host serve --no-relay` starts local-only
  - `scorel host serve --relay <url>` uses a self-hosted Relay
  - `scorel host serve --replace` stops an already-running local Host and starts a fresh one
  - `scorel pair <code>` uses the official Relay by default
  - `scorel pair <code> --relay <url>` remains for self-hosted Relay
  - `scorel relay serve` runs a Relay service for self-hosting/development
- Keep implementation aliases where needed:
  - `scorel daemon ...` may remain as a compatibility/internal alias during pre-1.0
  - docs and usage output must prefer `host`
- Update CLI help, README, docs, and tests to match the new command model.
- Keep `scorel up` as a development convenience for local Host + local WebUI, not the primary hosted user path.
- Ensure previously landed S0061 Vercel install/build support is represented in the docs where relevant.

## Non-Goals

- Do not add accounts or OAuth.
- Do not add hosted execution.
- Do not make Relay store Project, Session, prompt, tool result, provider response, or replay state.
- Do not implement desktop GUI.
- Do not implement SSH remote bootstrap.
- Do not introduce a second daemon/Host protocol.
- Do not silently kill an actively running Host without an explicit replacement rule.

## Contract

### Normal CLI Execution

```bash
scorel
```

Runs interactive Scorel in the current shell directory. That directory is the current Project. The command should create/register the Project through the existing Host/project registry path as needed, not invent a separate cwd-only execution path.

Explicit form:

```bash
scorel chat
scorel chat --cwd <dir>
```

`--cwd` remains an advanced override. Product docs should teach `cd <project> && scorel`.

### Local Host

```bash
scorel host serve
```

Starts this device's Scorel Host. Default behavior:

- local WS Host starts with the existing persistent token/state model
- `process.cwd()` is registered as the initial Project
- Host connects outbound to the official Relay
- Host keeps Relay connection alive with automatic reconnect
- stdout prints local Host URL, device identity, Relay status, and hosted WebUI URL

Local-only:

```bash
scorel host serve --no-relay
```

Self-hosted Relay:

```bash
scorel host serve --relay <relay-url>
```

Replacement:

```bash
scorel host serve --replace
```

If a previous Host state is stale/dead, `host serve` may clean it up automatically. If a Host is live, default behavior must not silently kill it. It should fail with a clear message telling the user to pass `--replace`.

### Pairing

```bash
scorel pair <code>
```

Redeems a hosted WebUI pair code through the official Relay by default.

Self-hosted override:

```bash
scorel pair <code> --relay <relay-url>
```

### Relay Operator

```bash
scorel relay serve
```

Runs a Relay service for self-hosting/development. This command maps to the existing `apps/relay` process and should expose host, port, and data-dir flags.

## Acceptance Criteria

- `scorel --help` shows `scorel`, `scorel host serve`, `scorel pair`, and `scorel relay serve` as the primary command surface.
- `scorel` with no subcommand enters the same interactive project flow currently reached by `scorel chat`.
- `scorel host serve` starts a local Host, registers the current cwd as an initial Project, and attempts Relay connection by default.
- `scorel host serve --no-relay` starts without opening a Relay connection.
- `scorel host serve --relay <url>` connects to the provided Relay.
- `scorel host serve` auto-recovers stale daemon state but refuses to replace a live Host unless `--replace` is provided.
- `scorel host serve --replace` stops the live previous Host and starts a fresh Host.
- Relay reconnect is automatic after transient Relay socket loss.
- `scorel pair <code>` works against the official Relay without requiring `--relay`.
- `scorel pair <code> --relay <url>` still works for self-hosted Relay tests.
- `scorel relay serve` can start the Relay service with a file-backed store.
- `scorel daemon ...` aliases either continue to work or produce a clear pre-1.0 migration message; they must not be the documented primary path.
- Root README and `docs/SHIP.md` quickstart no longer teach `scorel daemon serve --cwd --relay` as the user-facing hosted path.
- Hosted WebUI quickstart references `https://scorel.channel.dev`.

## Test Requirements

- CLI unit tests cover:
  - no-subcommand `scorel` dispatches to chat/interactive flow
  - `host serve` parses default Relay, `--no-relay`, `--relay`, and `--replace`
  - live Host replacement requires `--replace`
  - `pair` uses the default Relay when `--relay` is omitted
  - `relay serve` parses host/port/data-dir and starts through the existing Relay server path
- Daemon/Host tests cover Relay reconnect behavior without adding test-only product branches.
- Existing Relay tests continue to use real local WebSocket servers and file stores.
- Run:

```bash
pnpm typecheck
pnpm test
```

- If hosted deploy readiness is claimed in this spec's implementation, also run the relevant Vercel/build verification command and record the exact command in a verification note.

## Verification

Completed on 2026-06-06:

```bash
pnpm --filter @scorel/app-cli test
pnpm --filter @scorel/daemon test -- src/relay/host-client.test.ts
pnpm typecheck
pnpm test
git diff --check
```

## Affected Paths

- `apps/cli/src/index.ts`
- `apps/cli/src/daemon-cli.ts`
- `apps/cli/src/relay-cli.ts`
- `apps/cli/src/up-cli.ts`
- `apps/cli/src/*.test.ts`
- `apps/relay/src/index.ts`
- `packages/daemon/src/relay/*`
- `packages/daemon/src/*`
- `docs/SHIP.md`
- `docs/ROADMAP.md`
- `README.md`
- `docs/README.md`
- `docs/spec/relay.md`
- `package.json`
- `pnpm-lock.yaml`
- `pnpm-workspace.yaml`

## Risks

- Renaming `daemon` to `host` can churn tests and docs. Keep aliases or explicit migration messages during pre-1.0.
- Default Relay connection can make local startup depend on public service availability. `--no-relay` must be obvious and reliable.
- `--replace` can interrupt running sessions. Do not make live-process replacement silent.
- Treating no-subcommand `scorel` as chat must not hide parse errors for known commands.
- Hosted defaults must not become hard-coded in places that prevent self-hosting.
