# S0086: Auto Compact And Session Memory

## Goal

Ship the first simple automatic context compaction path and optional session memory maintenance.

The business value is continuity in long-running GUI/CLI sessions: Scorel should avoid waiting until context overflow, keep recent turns intact, and preserve enough current-task state for the model to continue after older history is summarized.

In S0086, **session memory is context management, not long-term memory**. It is an asynchronous pre-compact summary of the current session. It exists so auto compact can replace old context immediately at the threshold instead of blocking the user turn while generating a summary.

## Scope

### Auto Compact

Before a new user turn runs, Host estimates the current LLM context size for the active session. If the estimate reaches the configured threshold, Host appends one persistent `compact` event. Host prefers the already-maintained session memory summary, but still falls back to the original foreground agent compact when session memory is missing.

Default threshold:

```text
memory.autoCompactThreshold = 0.8
```

The threshold is a ratio of the selected model context window. If the selected model has no context window, Scorel falls back to the existing internal 200,000 token window assumption.

Compact behavior:

- compact only old history before the recent retention window;
- keep up to the most recent 8 conversation events after the compact event, starting only from a replay-safe boundary;
- write session memory content into JSONL as a `compact` event when available;
- if session memory is unavailable, run a foreground auxiliary compact summary and write that summary instead;
- do not delete or rewrite old JSONL events;
- `buildContext()` injects the compact summary and stops walking earlier history;
- compact is cheap at threshold time when session memory is fresh, but must still compact through the original foreground path when no session memory exists.

The first implementation keeps a small fixed retention budget of recent conversation events. The retained suffix must start at `user_message`, `compact`, or an `assistant_message` that contains a `tool_call`. This keeps recent long-running tool evidence replayable while avoiding an orphan `tool_result` as the first retained message. It does not expose manual compact UX.

### Session Memory

Add a project setting:

```text
memory.sessionMemory = true
```

When enabled, Host maintains a per-session memory file after completed turns:

```text
~/.scorel/context/session-memory/<projectId>/<sessionId>.md
```

Session memory is current-session continuity, not root/project memory. It captures:

- current task/status;
- important decisions;
- files or commands that matter for continuation;
- blockers/follow-ups;
- a short recent-work log.

Session memory is updated asynchronously after completed turns. At compact time, Host directly uses this file as the compact summary when session memory is enabled and available.

If a session memory update is already in flight when compact is needed, Host waits up to 5 seconds for that update. If the update does not finish in time, Host continues with foreground compact instead of waiting indefinitely. This gives the async pre-compact path a realistic chance to finish without letting a stale or slow background task block the main user turn.

If `memory.sessionMemory = false`, auto compact still works through the original foreground compact path. The toggle only controls asynchronous pre-compact maintenance.

### GUI Settings

GUI Settings Memory section exposes:

- session memory toggle;
- auto compact threshold select.

These controls use the device-scoped memory config path; memory status and persisted memory artifacts remain project-aware activity data.

## Not In Scope

- Manual `/compact` command.
- User-facing compact history browser.
- Token counting through provider APIs.
- Semantic recall or vector memory.
- Topic memory files.
- Cross-process scheduled session memory repair.
- Deleting, truncating, or rewriting historical JSONL.

## Acceptance Criteria

- `[memory]` parses/renders `sessionMemory` and `autoCompactThreshold`.
- GUI Settings renders real controls for session memory and compact threshold.
- `PersistentEvent` includes `compact`.
- Session replay treats `compact` as a conversation barrier: context starts with the summary and does not include older events.
- Host checks compact before each user turn and appends `compact` once the estimated context reaches 80% of the selected model window.
- Compact keeps recent context after the barrier by replaying the compact summary plus the retained recent safe event suffix.
- After completed turns, Host updates the session memory file when enabled.
- Session memory is project/session-scoped and does not update root or project `MEMORY.md`.
- If session memory maintenance is in flight when compact is needed, Host briefly waits for it and then proceeds.
- If session memory is unavailable, Host falls back to foreground auxiliary compact and still appends `compact`.
- Failures in session-memory maintenance write diagnostics but do not fail the user turn.

## Testing Requirements

- Core session tests for `compact` parsing and barrier context.
- Config tests for new memory fields.
- Daemon tests proving auto compact appends `compact` and session memory is maintained.
- GUI render tests proving the controls are visible.
- Full `pnpm typecheck && pnpm test`.

## Impacted Files

- `packages/protocol/src/events.ts`
- `packages/core/src/config/index.ts`
- `packages/core/src/session/index.ts`
- `packages/core/src/session/session.test.ts`
- `packages/core/src/memory/index.ts`
- `packages/core/src/memory/memory.test.ts`
- `packages/daemon/src/index.ts`
- `packages/daemon/src/embedded/embedded.test.ts`
- `apps/gui/src/renderer/settings/sections/MemorySection.tsx`
- `apps/gui/src/renderer/gui-shell.test.tsx`
- `docs/ROADMAP.md`

## Risks And Boundaries

- Token estimation is approximate. This is acceptable for V1 because the trigger is intentionally conservative and uses the same rough estimate style as existing context-budget tooling.
- A stale session memory can lose nuance. V1 keeps recent turns intact and preserves full JSONL evidence for audit/replay.
- Session memory should be treated as continuity notes, not current code truth.
