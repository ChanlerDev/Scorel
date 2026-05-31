# S0043: Startup Ergonomics — Single `scorel` Entry, Auto Token, WebUI Auto-Detect, `scorel up`

## Goal

Collapse the multi-binary, multi-flag, multi-terminal startup flow into a single `scorel` entrypoint with sensible defaults, persistent token, and a one-command `scorel up` that brings up daemon + WebUI together. Eliminate every step in the current "open two terminals, type four required flags, copy a token into a browser form" loop.

Locked discussion: `self/discussions/2026-05-31-webui-polish-brainstorm.md` follow-up turn (this session). Decisions:

- Single `scorel` binary; retire `scorel-daemon` (apps/daemon bin removed).
- No backward compatibility — project still pre-1.0.
- Default host `127.0.0.1` (loopback).
- Token persisted in `~/.scorel/daemon.json`, generated once, reused across runs.
- daemon.json never auto-deleted; reused across restarts via pid liveness check.

This spec replaces the M3-era `scorel-daemon start` (local unix socket) entirely. Everything that connected over `daemon.sock` either moves to embedded transport (CLI `scorel chat`) or to the WS daemon (`scorel daemon serve`).

## Scope

### CLI command surface (after this spec)

```
scorel chat [--session <id>] [--cwd <dir>]
scorel attach [--session <id>] [--remote <ws-url> --token <token>]
scorel daemon serve [--host <h>] [--port <p>] [--token <t>] [--cwd <d>]
scorel daemon status
scorel daemon stop
scorel daemon reset
scorel webui [--port <p>] [--host <h>]
scorel up [--daemon-port <p>] [--webui-port <p>] [--cwd <d>]
scorel logs [--attach] --session <id> [--remote <ws-url>] [--tail <n>]
```

Removed: every `scorel-daemon ...` invocation, every `scorel daemon start|status|stop` form bound to `daemon.sock`. The local unix socket path (`~/.scorel/daemon.sock`) is no longer used; only the WS daemon (`serve`) remains.

### `scorel daemon serve` defaults

| Flag | Default |
|---|---|
| `--host` | `127.0.0.1` |
| `--port` | `7777` |
| `--token` | `daemon.json.token` if file exists; else `crypto.randomUUID()`, persisted |
| `--cwd` | `process.cwd()` |

Any explicit `--token <new>` rotates and overwrites the stored token. Any explicit `--host` / `--port` overwrites the stored fields too (so `daemon status` reflects current state).

### `~/.scorel/daemon.json` schema (replaces M3 shape)

```ts
type DaemonStateFile = {
  host: string;
  port: number;
  wsUrl: string;             // derived: ws://host:port (host literal as written)
  token: string;             // persistent, regenerated only via reset or explicit --token
  cwd: string;
  pid: number;               // process holding the lock; may be stale
  startedAt: number;         // Date.now()
  stoppedAt: number | null;  // null while running; populated on graceful exit
};
```

Lifecycle:

- `serve`:
  1. Read existing file (if any). Reuse `token` unless `--token` overrides.
  2. If file present and `stoppedAt === null`, run `process.kill(pid, 0)` to liveness-check.
     - Alive **and** mode is the same → exit 1 with `scorel daemon already running pid=<pid> url=<wsUrl>`.
     - Dead → fall through (treat as orphan, overwrite).
  3. Write file with new `pid`, `startedAt`, `stoppedAt: null`, current host/port/cwd, reused or fresh token.
  4. Boot `startEmbeddedDaemonWebSocketServer`. On graceful shutdown (SIGINT/SIGTERM/`server.close()`) update `stoppedAt = Date.now()`. Do **not** delete the file.
  5. Crash path leaves `stoppedAt: null` with a dead pid; next `serve` cleans it up.
- `status`:
  - File missing → exit 1, `scorel daemon not configured`.
  - File present, pid alive, `stoppedAt === null` → exit 0, print `running url=<wsUrl> pid=<pid> token=<token>` (token printable only for local-loopback config; if `host !== 127.0.0.1` and stdout is a TTY, prompt before print or require `--show-token`).
  - File present, pid dead or `stoppedAt` set → exit 0, print `stopped url=<wsUrl> last-pid=<pid> stoppedAt=<ts>`.
- `stop`:
  - File present + alive pid → `process.kill(pid, "SIGTERM")`; wait up to 5s for `stoppedAt` to populate; force `SIGKILL` if not.
  - File missing or pid dead → exit 0 with note.
- `reset`:
  - Delete `daemon.json`. Print `daemon state reset; next serve will generate a new token`.

### `scorel webui` subcommand

- Spawns `next dev` from `apps/webui` workspace via the workspace's own `pnpm dev` (resolved relative to the package using `pnpm --filter @scorel/app-webui dev`, or by spawning `node_modules/next/dist/bin/next` directly to avoid a recursive pnpm hop).
- Flags: `--port` (default 3000), `--host` (default `127.0.0.1`).
- Forward env: `PORT`, `HOST` to next.
- Stream stdout/stderr with `[webui]` prefix.

### `scorel up` subcommand

- Reads `~/.scorel/daemon.json` if present, otherwise generates on the fly via the same `serve` path.
- Spawns daemon serve in-process (subprocess) with current defaults; waits until it logs `scorel daemon serving url=<wsUrl>` before continuing (parse stdout line).
- Spawns `scorel webui --port <webui-port>` as a separate child process.
- Prints unified header:
  ```
  scorel up
    daemon  ws://127.0.0.1:7777  token=<token>
    webui   http://127.0.0.1:3000
  ```
- SIGINT (Ctrl+C) propagates SIGTERM to both children; awaits both exits; final line `scorel up stopped`.
- If either child dies unexpectedly, kill the other and exit 1.

### WebUI auto-detect

New file `apps/webui/app/api/local-daemon/route.ts` (Next App Router server route):

```ts
export async function GET(): Promise<Response> {
  // Reads ~/.scorel/daemon.json server-side.
  // Returns 404 if missing.
  // Returns 200 { wsUrl, token, cwd, host, port } if present.
  // Important: this route runs on the WebUI server, which is on the user's machine.
  //            It must NOT be exposed when WebUI is hosted somewhere else.
  //            For v1 we only support local dev (next dev on the user's box), so reading the file is OK.
  //            Document the invariant in apps/webui/README.md.
}
```

Constraint: this route only fires when both daemon and webui run on the same machine (default flow). If a user hosts webui on another host, the route returns 404 because `~/.scorel/daemon.json` does not exist on that host. Acceptable v1.

WebUI Settings page changes:

- On Settings mount, call `fetch("/api/local-daemon")` once.
- If 200 and no existing device matches `wsUrl + token`, render a banner card above the device list:
  ```
  Detected local daemon
  ws://127.0.0.1:7777   cwd=/Users/.../Scorel
  [Use this device]
  ```
- Click → BrowserStore.upsertDevice with `{ name: "Local", link: wsUrl, token }`. Navigate to `/devices/<id>`.
- If a matching device already exists, no banner (to avoid duplicates).

### Retire `apps/daemon`

- Delete `apps/daemon/src/index.ts` bin entry (entire `apps/daemon/` directory removed).
- Move daemon-app logic that doesn't already live in `packages/daemon` into `apps/cli/src/daemon-cli.ts` (new file) imported by `apps/cli/src/index.ts`.
- Remove `pnpm-workspace.yaml` reference if it lists the package explicitly.
- Remove root `package.json` `scorel-daemon` script.
- Update root `dev` script (new): `"dev": "node --import tsx apps/cli/src/index.ts up"`.

### `packages/daemon` shape change

`LocalDaemonState` type updated:

```ts
export type LocalDaemonState = {
  host: string;
  port: number;
  wsUrl: string;
  token: string;
  cwd: string;
  pid: number;
  startedAt: number;
  stoppedAt: number | null;
};
```

`socketPath` removed. `startLocalDaemonSocketServer` and friends removed (not used anywhere after this spec). Search-and-destroy passes:

```bash
rg "socketPath|daemon\.sock|startLocalDaemonSocketServer|NodeSocketTransport" -- packages/ apps/
```

Each remaining hit must be either deleted or migrated.

`createLocalDaemonState` / `readLocalDaemonState` keep their function names; payload schema follows the new shape. New helpers:

- `daemonStateLiveness(state): "running" | "stopped" | "orphan"` — encapsulates the pid liveness + `stoppedAt` logic.
- `markDaemonStopped(stateDir, stoppedAt)` — partial update used by graceful shutdown.

### Tests

CLI (`apps/cli/src/index.test.ts`):

- `daemon serve` honors defaults (mock `startEmbeddedDaemonWebSocketServer`, capture call args).
- `daemon serve` reuses token across two invocations via a tmp `stateDir`.
- `daemon serve` rejects when prior pid is alive (mock `process.kill(pid, 0)`).
- `daemon serve` overwrites stale orphan state (`stoppedAt: null` + dead pid).
- `daemon status` prints running/stopped lines.
- `daemon stop` issues SIGTERM and waits for `stoppedAt`.
- `daemon reset` deletes the state file.
- `webui` subcommand spawns next with correct env (mock `child_process.spawn`).
- `up` orchestrates daemon ready-detection then webui spawn (mock spawn + scripted stdout).
- `up` SIGINT propagates SIGTERM to both children.

Daemon package (`packages/daemon/src/protocol.test.ts`):

- Update existing tests for new `LocalDaemonState` shape.
- New test for `daemonStateLiveness` covering running / stopped / orphan / missing-file.
- Delete tests touching `daemon.sock` and `startLocalDaemonSocketServer`.

WebUI (`apps/webui/src/api-local-daemon.test.ts` new):

- 200 path: file present, parses, returns wsUrl+token+cwd.
- 404 path: file missing.
- 500-ish defensive path: malformed JSON → 404 + console.warn (do not crash dev server).
- Token present in the response body but never logged. Asserted by spying console.

Settings UI test (`apps/webui/components/settings/device-list.test.tsx` extend):

- Mocks `fetch("/api/local-daemon")` returning 200; renders banner; click adds device; banner disappears.
- Mocks 404; banner not rendered.
- Existing matching device → banner not rendered.

### Docs

- `docs/SHIP.md`: add Quickstart section near the top:
  ```
  ## Quickstart
  pnpm install
  pnpm dev          # = scorel up; daemon + WebUI
  open http://127.0.0.1:3000
  ```
- `apps/webui/README.md`: document `/api/local-daemon` invariant (server-side route, only useful when WebUI runs on same host as daemon).
- `docs/ROADMAP.md`:
  - Add new milestone `M5.6: Startup Ergonomics` with goal + Done table.
  - Mark S0043 row `Done` after this spec ships.

## Not In Scope

- Custom `cwd` per WebUI device (still daemon-side at startup).
- Skills / Plugins / OAuth / TLS / public tunnel.
- Multi-daemon side-by-side (one daemon.json per `~/.scorel`).
- Auto-restart / supervisor (still manual `scorel daemon stop && scorel daemon serve`).
- Token rotation API; only `--token` flag overrides on next serve.
- Browser-side detect-on-every-page-load (only Settings mount).
- Windows-specific path/PID semantics (development on macOS/Linux primary).

## Acceptance Criteria

- A clean machine flow takes the user from `git clone` to a working WebUI + first prompt in **two commands**:
  ```
  pnpm install
  pnpm dev
  open http://127.0.0.1:3000  # Settings shows "Detected local daemon"
  ```
- `apps/daemon/` is gone from the workspace.
- `scorel-daemon` script removed from root `package.json`.
- `scorel daemon serve` runs without any required flags; subsequent invocations reuse the token.
- `~/.scorel/daemon.json` survives daemon restart; `token` value identical across runs.
- `scorel daemon status` correctly distinguishes running / stopped / orphan based on pid liveness + `stoppedAt`.
- `scorel up` brings up both children, prints unified header, terminates both on Ctrl+C.
- WebUI `/api/local-daemon` returns the JSON only when the file exists; the response is consumed by the Settings page banner.
- Settings banner renders exactly once and adds the device on click; it disappears after add.
- All `daemon.sock` / `socketPath` / `NodeSocketTransport` code paths removed; `rg "daemon\\.sock"` returns no production hits.
- `pnpm typecheck && pnpm test` green.
- `pnpm --filter @scorel/app-webui build` green.
- Manual smoke: with real provider in `~/.scorel/config.toml`, run `pnpm dev` from a fresh `~/.scorel`; click "Use this device"; send a real prompt; receive a streamed reply.

## Affected Paths

- `apps/cli/src/index.ts` — add `daemon serve|status|stop|reset`, `webui`, `up` subcommands; route `daemon` argv through new `daemon-cli.ts`.
- `apps/cli/src/daemon-cli.ts` (new) — daemon serve/status/stop/reset implementations.
- `apps/cli/src/up-cli.ts` (new) — `scorel up` orchestrator.
- `apps/cli/src/webui-cli.ts` (new) — `scorel webui` spawner.
- `apps/cli/src/index.test.ts` — extend.
- `apps/daemon/` — **deleted** (package + bin retired).
- `pnpm-workspace.yaml` — drop `apps/daemon` if listed.
- `packages/daemon/src/index.ts` — new `LocalDaemonState` schema, drop socket helpers, add `daemonStateLiveness` + `markDaemonStopped`.
- `packages/daemon/src/protocol.test.ts` — schema + helper tests; drop socket tests.
- `apps/webui/app/api/local-daemon/route.ts` (new).
- `apps/webui/src/api-local-daemon.test.ts` (new).
- `apps/webui/components/settings/device-list.tsx` — render detected-daemon banner.
- `apps/webui/components/settings/device-list.test.tsx` — extend for fetch mock.
- `apps/webui/README.md` — document auto-detect route.
- `docs/SHIP.md` — Quickstart section.
- `docs/ROADMAP.md` — add M5.6 + S0043 entry, flip Done after ship.
- `package.json` (root) — replace `scorel-daemon` script removal; add `dev` = `scorel up`.

## Risks And Boundaries

- **Token leak via /api/local-daemon**: only same-origin fetch from a same-host browser tab; route is a server route, never serialized into client bundles. Adversary scenarios all require local filesystem access already (game over). Acceptable; document.
- **`scorel up` orphaning children on crash**: if the parent dies between spawn-daemon and spawn-webui, daemon keeps running. That's actually desirable (idempotent next `up` will detect it and only spawn webui). Test path covers it.
- **PID reuse**: a long-stopped daemon pid could collide with a newly assigned pid post-reboot. `process.kill(pid, 0)` returns true even if it's some unrelated process. Mitigated by checking `startedAt` proximity? No — too fragile. Accept the rare false-positive; user can `scorel daemon reset`.
- **Unix-only `process.kill(pid, 0)`**: on Windows the semantics differ; project is macOS/Linux primary, document and skip.
- **WebUI banner double-trigger**: race between fetch and existing-device list load. Implementation must wait until BrowserStore hydrated before rendering banner; otherwise we'd flash "detected" then hide. Test the order.
- **Single daemon assumption**: project-wide `~/.scorel` assumes one daemon per user. Multi-daemon requires `--state-dir <custom>` flag, which exists in code paths but is not surfaced as part of this spec; documented as a power-user override.
- **Removed mode `start` (unix socket)**: any spec that depended on `daemon.sock` (S0014/S0015 era) is now historical; the WS daemon is the only daemon in production paths.
- **PR scope**: large blast radius (touches 4 packages). Single commit per SHIP.md convention: `S0043: feat: collapse startup to a single scorel entry with auto token`.
