# S0026: Attach Project Cache And Dual-Seq Reconnect

## Goal

Fix attach recovery so local and remote project sessions can resume from a client-owned persistent cache, while reconnect semantics remain aligned with daemon authority.

This spec closes the gap left by S0024/S0025: reconnect must distinguish between durable client state and previously seen stream state, support project-scoped session storage for both local and remote projects, and continue live streaming after persistent fallback.

## Scope

- Introduce a project-scoped session storage model for attach-visible session persistence instead of treating all sessions as flat global files.
- Define local and remote project identity at the same abstraction level:
  - local projects under a local scope
  - remote projects under a remote device scope
- Remote attach cache identity is `deviceId + projectSlug + sessionId`. The connection URL is a transport endpoint and may be used only as a fallback before daemon identity is known.
- Daemon connection metadata must expose a stable `deviceId`, optional user-facing `deviceDisplayName`, and a stable `projectSlug` for the served project.
- Store client-visible persistent session backlog under the project scope so attach can render local persistent history before daemon reconciliation.
- Store in-progress assistant transient text under the same project scope when the client has durable stream anchors, so a process restart can display the already-seen prefix before asking daemon to continue from `streamLastSeq`.
- Define dual reconnect anchors:
  - `persistentLastSeq`: highest seq guaranteed by locally persisted persistent events
  - `streamLastSeq`: highest seq the client has actually observed in the event stream
- Upgrade reconnect/resync contract so daemon can distinguish:
  - stream resume from buffer
  - persistent-only fallback
  - full reload
- Define persistent fallback semantics precisely:
  - daemon only replays missing persistent events
  - client immediately returns to live subscription after fallback completes
  - lost transient continuity before the fallback boundary is treated as unrecoverable, not silently reconstructed
- Define the cutover boundary between fallback replay and subsequent live stream so fallback does not skip live events produced during recovery.
- Define cache mismatch behavior for stdout-only clients that cannot visually roll back pre-rendered history.
- Keep local attach and remote attach on the same product path and cache model.
- Update spec/docs language so `lastSeq` is no longer treated as a single sufficient reconnect anchor once client-owned cache exists.

## Not In Scope

- Full byte-for-byte reconstruction of transient events after client process restart.
- Full TUI scrollback manager or editor-like terminal persistence.
- Automatic daemon crash recovery beyond current daemon-owned session persistence.
- Relay/tunnel/public remote service features.
- Background reconnect daemon running outside the CLI attach process.

## Acceptance Criteria

- A local attach client and a remote attach client both map their session persistence through a project-scoped directory instead of a flat global session file assumption.
- Remote project sessions are separated from local project sessions by `deviceId + projectSlug` scope and do not collide with same-path local workspaces.
- If the same remote daemon project is reached through a different URL, attach can still reuse cache when daemon reports the same `deviceId + projectSlug`.
- `deviceDisplayName` is metadata for user-facing labels only; it must not replace stable `deviceId` in cache identity.
- Reconnect protocol explicitly carries both `persistentLastSeq` and `streamLastSeq`.
- If daemon buffer covers `streamLastSeq`, reconnect resumes the stream from `streamLastSeq + 1`.
- If daemon buffer does not cover `streamLastSeq` but client has persistent cache, daemon falls back to replaying only missing persistent events after `persistentLastSeq`, then the connection continues receiving future live transient and persistent events.
- Client can tell whether reconnect result was `stream_resume`, `persistent_fallback`, or `full_reload`; the mode is not inferred implicitly.
- Daemon proves buffer coverage by checking that the buffered stream continuously covers `streamLastSeq + 1`; having any later buffered event is not enough.
- In `persistent_fallback`, `throughSeq` is the highest replayed persistent seq, not blindly the daemon current seq. Future live events with higher seq remain deliverable after the replay response.
- CLI attach pre-renders only cache entries whose project/session metadata match the requested attach target; if daemon reconciliation reports `full_reload`, stale printed cache is separated from authoritative replay instead of being silently treated as current history.
- Cold-start attach does not claim stream resume from a transient seq unless the client has durable transient anchors for that stream. Without such anchors, it uses the persistent anchor and accepts fallback semantics.
- Resynced transient events returned in `resync_events.events` are delivered to subscribers/renderers, not only folded into internal client state.
- CLI attach reads input into a queue and serializes sends, so lines typed or pasted while a turn is running are queued instead of being hidden behind the pending `sendMessage` await.
- `pnpm typecheck && pnpm test` passes.
- Manual validation covers one real remote daemon and one local attach client reconnecting through the new semantics.

## Tests

- Add focused protocol/client/CLI tests for dual-seq reconnect semantics.
- Add tests for project-scope session directory resolution for local and remote projects.
- Add tests proving persistent fallback returns to live event streaming instead of leaving the client in replay-only mode.
- Add tests for buffer gap detection, fallback `throughSeq` cutover, same `sessionId` under different project scopes, and duplicate-free CLI rendering from cache + daemon replay.
- Run `pnpm typecheck && pnpm test`.
- Run one manual real-process validation with real provider path, real temporary workspace, real JSONL session, and remote reconnect.

## Affected Paths

- `docs/spec/client.md`
- `docs/spec/daemon.md`
- `docs/spec/session.md`
- `docs/architecture.md`
- `docs/ROADMAP.md`
- `docs/spec/ship/S0026-attach-project-cache-and-dual-seq-reconnect.md`
- `self/discussions/2026-05-29-attach-project-cache-dual-seq.md`

## Risks And Boundaries

- Project key design must stay readable without using fragile reversible path encoding as the source of truth; metadata must preserve the real locator.
- `deviceId` is sufficient as a remote namespace only if project metadata also stores the original remote workspace locator.
- Dual-seq reconnect adds protocol complexity; daemon and client must share one exact recovery-state model to avoid hidden divergence.
- Persistent cache is a client-side acceleration and recovery aid, not a replacement for daemon session authority.
- Terminal stdout cannot retract stale cache output. CLI must prefer conservative rendering and explicit recovery markers over optimistic UI tricks that only work in GUI clients.
