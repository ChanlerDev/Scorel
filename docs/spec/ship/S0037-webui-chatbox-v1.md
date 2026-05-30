# S0037: WebUI Chatbox v1

## Goal

Open a session and see a working chatbox: history rendered from attach-cache (instant), reconciled with daemon via dual-seq resync, live event stream (user / assistant / streaming delta / tool call / tool result) projected to UI, and a composer that sends prompts. No `cancel` (S0038) and no `New Chat` (S0039) yet.

## Scope

- Session attach in `apps/webui/lib/connection/session.ts`:
  - On chatbox mount, take the device's `DaemonClient`, call `connect({ sessionId, persistentLastSeq, streamLastSeq })` using anchors from attach-cache.
  - Subscribe to `event` messages and feed them to the projector.
  - On unmount or session change, unsubscribe but keep the underlying client connection (pool-managed).
- Attach-cache in `apps/webui/lib/store/attach-cache.ts`:
  - Key: `scorel:webui:v1:attach-cache:<scopeKey>:<sessionId>`. `scopeKey = sha256(kind\0locator).hex.slice(0,24)`; for WebUI always `kind="remote"`, `locator="device:<remoteDeviceId>/project:<projectSlug>"`.
  - `scopeKey` computed via Web Crypto SubtleCrypto in browser (async); cache the result per (deviceId, projectSlug, sessionId) tuple in memory.
  - File shape: `{ version: 1, scope, sessionId, events: PersistentEvent[], transients?: { eventId, seq, text }[] }` (mirrors CLI `AttachCacheFile`).
  - Append on every received persistent event; truncate transients on `turn_end`.
  - Quota fallback: if `setItem` throws QuotaExceeded, drop oldest transients first, then evict the least-recently-used non-current session's cache.
- Event projector in `apps/webui/lib/events/projector.ts`:
  - Reduce `(state, event)` into a list of UI turns: `[{ id, kind: "user" | "assistant" | "tool", parts: TurnPart[] }]`.
  - Streaming delta merges into the in-flight assistant turn keyed by `assistantEventId` from `message_start`.
  - Tool calls and tool results group under their assistant turn.
  - Final `assistant_message` event replaces the streamed assistant turn (deduplicate via id).
  - Skip events whose `seq` is already incorporated.
- Chatbox UI in `app/devices/[deviceId]/projects/[projectSlug]/sessions/[sessionId]/page.tsx` (client component):
  - Header: session title, model, last updated.
  - Transcript: scrollable, autoscroll-on-new-event when scrolled to bottom; preserve position otherwise.
  - Turn renderers: user (markdown-light, plain text initially fine), assistant (streaming-aware), tool call (collapsible JSON), tool result (collapsible).
  - Composer: textarea + Send button; `Enter` submits, `Shift+Enter` newline. Empty submit ignored. `Send` calls `client.sendMessage(content)`; optimistic local user turn shown before server echoes.
  - Loading state: while initial resync is pending, show "Loading session…" skeleton.
- Resync handling:
  - `connect({ sessionId, persistentLastSeq, streamLastSeq })`. Persist anchors after every applied event:
    - `persistentLastSeq = max(seq of last applied PersistentEvent)`.
    - `streamLastSeq = max(seq of last applied event of any kind)`.
  - If daemon returns `mode === "full_reload"`, drop projector state and re-render from scratch using returned events.
  - If `mode === "persistent_fallback"`, append returned persistent events; transients before the boundary are gone (acceptable; CLI behaves the same).
  - If `mode === "stream_resume"`, just append.
- Markdown / formatting v1: render text as preformatted with line wrapping. Code blocks not specially handled v1; skip syntax highlighting to keep this spec focused.

## Not In Scope

- `cancel` (S0038).
- `New Chat` (S0039).
- Multi-client conflict UX beyond what daemon already broadcasts.
- Rewind / fork / compact UI.
- File attachments, images, audio.
- Markdown rendering library, syntax highlighting, math, mermaid.
- Tool result rendering specialization (e.g., diff viewer for Edit results) — generic JSON dump is fine v1.

## Acceptance Criteria

- Opening a session in WebUI:
  - Renders cached events instantly when attach-cache is present.
  - Issues a resync `connect` with persistent + stream anchors.
  - Shows the same transcript as a parallel `scorel attach` against the same daemon (within event ordering tolerance).
- Sending a prompt: composer clears, optimistic user turn appears, daemon echoes the persisted user message, assistant streaming text accumulates, final assistant message and any tool calls appear.
- Reloading the WebUI tab restores the chatbox from cache, then resyncs and continues live.
- Daemon-side persistent fallback (force by clearing daemon ring buffer) still produces a continuous transcript.
- attach-cache size stays under ~1.5MB per session for a typical 100-turn run; quota eviction never silently drops the active session.
- `pnpm --filter @scorel/webui typecheck && pnpm --filter @scorel/webui test` passes.
- Repo `pnpm typecheck && pnpm test` passes.
- Manual: real daemon + real LLM provider; send "list files in cwd" prompt that invokes a tool; verify event stream renders correctly; reload tab; transcript preserved.

## Tests

- Projector unit tests covering: streaming delta merge, dedup, tool call/result grouping, full_reload reset.
- attach-cache tests for: append, truncate transients on turn_end, quota fallback ordering (transients → LRU).
- session attach tests with a fake `DaemonClient`: mode handling for stream_resume, persistent_fallback, full_reload.
- Component test for chatbox renderer (render fixture transcript; assert turn order and content).
- Manual: as above.

## Affected Paths

- `apps/webui/lib/connection/session.ts` (new)
- `apps/webui/lib/connection/session.test.ts` (new)
- `apps/webui/lib/store/attach-cache.ts` (new)
- `apps/webui/lib/store/attach-cache.test.ts` (new)
- `apps/webui/lib/events/projector.ts` (new)
- `apps/webui/lib/events/projector.test.ts` (new)
- `apps/webui/lib/identity/scope-key.ts` (new — SubtleCrypto-based scope key)
- `apps/webui/lib/identity/scope-key.test.ts` (new)
- `apps/webui/components/chatbox/transcript.tsx` (new)
- `apps/webui/components/chatbox/composer.tsx` (new)
- `apps/webui/components/chatbox/turn-user.tsx` (new)
- `apps/webui/components/chatbox/turn-assistant.tsx` (new)
- `apps/webui/components/chatbox/turn-tool.tsx` (new)
- `apps/webui/app/devices/[deviceId]/projects/[projectSlug]/sessions/[sessionId]/page.tsx`
- `docs/ROADMAP.md` (M5 step entry for S0037)

## Risks And Boundaries

- The CLI projector logic in `apps/cli/src/index.ts` is the reference. Lift the algorithm; don't reinvent. Future spec can move it into `@scorel/client/reducer.ts`; this spec keeps it inside `apps/webui` to avoid scope creep.
- `localStorage` write throttling: every event causes a write today. If profiling shows hot path, batch writes via `requestIdleCallback` in a follow-up.
- Streaming text smoothness depends on event flush cadence; rely on daemon's existing transient delta cadence; do not add WebUI-side animation v1.
- Multi-tab same-session: each tab subscribes independently; both apply the same events. Acceptable but doubles localStorage writes; document.
- Markdown / code rendering deferred. Plain text v1 is honest; users who want pretty output add it later.
- attach-cache scope key uses SubtleCrypto, which is async. The first event in a session waits for the key promise; cache that promise per (deviceId, projectSlug, sessionId).
