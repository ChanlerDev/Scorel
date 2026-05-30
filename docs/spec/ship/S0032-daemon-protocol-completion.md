# S0032: Daemon Protocol Completion (Cancel, ListSessions, ListProjects)

## Goal

Restore and extend the daemon control protocol so M5 WebUI and CLI can:

- cancel an in-progress turn from any client
- list sessions scoped by `projectSlug`
- list the projects this daemon has served

The previous M5 attempt added `cancel` and partial `list_sessions`; both were rolled back in `4ebfabe`. This spec re-introduces them on top of S0031's daemon-owned `projectSlug`, plus a new `list_projects` request that exposes the daemon's project view to clients.

## Scope

- `@scorel/protocol`:
  - Re-add `cancel` request:
    ```ts
    cancel: {
      request: { sessionId: SessionId };
      response: { sessionId: SessionId; cancelled: boolean };
    };
    ```
  - Restore real `list_sessions` shape and add `projectSlug` filter:
    ```ts
    list_sessions: {
      request: { projectSlug?: string; limit?: number };
      response: { sessions: SessionSummary[] };
    };
    ```
  - Extend `SessionSummary` with `projectSlug: string` so callers can group across daemons.
  - New `list_projects` request:
    ```ts
    list_projects: {
      request: Record<never, never>;
      response: { projects: DaemonProjectSummary[] };
    };

    type DaemonProjectSummary = {
      projectSlug: string;
      displayName: string;        // basename(workDir)
      workDirHint?: string;       // absolute path daemon last saw
      sessionCount: number;
      lastSeenAt: number;         // max(updatedAt) over the project's sessions
    };
    ```
- `@scorel/daemon`:
  - Re-implement `#handleCancel` (logic identical to the rolled-back version).
  - Implement `list_sessions`:
    - source: in-memory session lanes plus on-disk `<sessionsDir>/*.jsonl` headers (lazy scan, same dir layout as today)
    - apply `projectSlug` filter when present
    - respect `limit` (default 200, max 1000)
    - sort by `updatedAt` desc, then `sessionId` asc for stability
    - return `currentSeq` from in-memory lane when loaded, else from JSONL header tail
  - Implement `list_projects`:
    - aggregate sessions in `<sessionsDir>/` by reading their headers (cwd in `meta` if present; else fall back to `toProjectSlug(daemon.workDir)`)
    - cache the scan in-memory; invalidate when a new session is created or appended
    - return all projects daemon has touched, even if every session is stale
  - Persist a session header field that pins the slug at session creation time so list_projects/list_sessions stay deterministic across daemon restarts (extend `SessionMeta` with `projectSlug?: string`; daemon writes it; readers prefer the header field).
- `@scorel/client`:
  - Re-add `DaemonClient.cancel()`.
  - Add `DaemonClient.listSessions(filter?: { projectSlug?: string; limit?: number })`.
  - Add `DaemonClient.listProjects()`.
  - All three thin wrappers around the request/response wire; no business logic.
- `apps/cli`:
  - CLI `chat` and `attach` keep working unchanged. CLI does not need to call `list_projects` in this spec; `cancel` and `list_sessions` are wired only when CLI features already use them (cancel-on-Ctrl-C exists today and was rolled back too — restore call site).
  - `scorel attach --remote` continues to populate the project-index file via `list_sessions` results (reuses the new shape).

## Not In Scope

- WebUI consumption (M5.4+).
- Project-index v2 / cross-device aggregation.
- Daemon-side session creation API (`create_session` already exists; not changed here).
- Permission gates / auth scopes around `cancel` (single-user model only).
- Pagination / cursors for `list_sessions` beyond `limit`.

## Acceptance Criteria

- Wire schema: `cancel`, `list_sessions`, `list_projects` are present in `packages/protocol/src/wire.ts` exactly as above; round-trip tests in `packages/protocol/src/index.test.ts` cover each.
- `EmbeddedDaemon`:
  - `cancel` returns `{ sessionId, cancelled: bool }` and writes a `cancel_requested` diagnostic; cancellation actually interrupts a running runtime turn (re-establish the rolled-back behavior, no regressions).
  - `list_sessions({ projectSlug })` returns only sessions matching the slug; `list_sessions()` returns all known sessions; `limit` clamps result size.
  - `list_projects()` returns one entry per distinct slug seen across sessions, with correct `sessionCount`, `lastSeenAt`, and `displayName`.
  - Session JSONL header includes `projectSlug` for new sessions; reading older sessions without that field falls back to `toProjectSlug(daemon.workDir)`.
- `DaemonClient` exposes `cancel()`, `listSessions()`, `listProjects()`. Cancel and listSessions throw if not connected to a session / daemon respectively; listProjects only requires daemon connection (no session).
- CLI Ctrl-C path triggers `cancel()` on the active session and prints a cancellation marker (restore prior behavior).
- `pnpm typecheck && pnpm test` passes.
- Manual real-daemon validation:
  - Run `scorel chat`, send a long-running tool prompt, Ctrl-C → daemon emits cancel, CLI shows cancelled.
  - Run two `scorel chat` sessions in different `--cwd` directories; a third client calling `listProjects()` returns both slugs with correct counts.

## Tests

- Protocol round-trip: every new message shape encodes/decodes via existing schema validators.
- Daemon unit tests for `list_sessions` filtering, sorting, limit clamping; `list_projects` aggregation across mixed in-memory and on-disk sessions; `cancel` happy path and "no running turn" path.
- DaemonClient unit tests for the three new methods (request id correlation, session-id requirement for cancel, error response handling).
- CLI test re-asserts Ctrl-C → cancel diagnostic.
- Manual: see Acceptance Criteria.
- Run targeted tests then `pnpm typecheck && pnpm test`.

## Affected Paths

- `packages/protocol/src/wire.ts`
- `packages/protocol/src/events.ts` (extend `SessionSummary` with `projectSlug`; add `DaemonProjectSummary` if it lives here, else add new `projects.ts` module — choose `events.ts` to avoid file proliferation)
- `packages/protocol/src/index.test.ts`
- `packages/daemon/src/index.ts`
- `packages/daemon/src/index.test.ts` (or new `protocol.test.ts` reintroduced)
- `packages/daemon/src/projects/aggregator.ts` (new — reads JSONL headers and aggregates by slug)
- `packages/daemon/src/projects/aggregator.test.ts` (new)
- `packages/client/src/index.ts`
- `packages/client/src/daemon-client.test.ts` (reintroduce, scoped to new methods)
- `apps/cli/src/index.ts`
- `apps/cli/src/index.test.ts`
- `docs/spec/daemon.md`
- `docs/spec/client.md`
- `docs/ROADMAP.md` (M5 step entry for S0032)

## Risks And Boundaries

- Reading every JSONL header on `list_projects` / `list_sessions` is O(N) over disk; acceptable for v1 (single-user, dozens to hundreds of sessions). Add an in-memory cache invalidated on session create/append so steady-state cost is constant.
- `projectSlug` collision (S0031 documented `-` ambiguity) means `list_projects` cannot reverse a slug back to a unique `workDir`; clients display `displayName` and `workDirHint` from the daemon and never reverse-engineer.
- Cancellation already had a rolled-back implementation in git history. Re-introduce that exact behavior; do not invent new semantics.
- `SessionMeta.projectSlug?` is additive; existing sessions without it remain readable (fallback path covered above).
- `list_projects` exposes daemon's full session map. Acceptable in single-user model; if multi-tenant ever lands, gating is a future spec.
