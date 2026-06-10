# S0081: Automatic Memory Context And Dreaming

> Updated by [`S0082`](S0082-memory-journal-tool-and-idle-dream.md): daily is now written through the agent-owned `AppendDaily` tool, and dream consolidation runs after project idle time instead of immediately after every turn.

## Goal

Ship Scorel's first automatic memory loop:

- inject memory context into the actual LLM `messages[]` via `harness_item kind="memory"`;
- automatically write a short project daily entry after completed turns;
- automatically consolidate durable project/root memory with the configured `auxiliary` model when available;
- expose GUI Settings controls for memory;
- support the macOS standard `Command+,` shortcut to open Settings.

The business value is continuity: a new or resumed session should know recent work, stable project decisions, and cross-project user preferences without the user manually asking the agent to read notes.

## Scope

### Memory Files

Use filesystem-backed memory under the fixed user root:

```text
~/.scorel/memory/
  MEMORY.md
  projects/
    <projectId>/
      MEMORY.md
      daily/
        YYYY-MM-DD.md
      dream-state.json
```

### Runtime Context

Memory content must enter the model through `messages[]`, not through duplicated provider-level `systemPrompt` text.

`instruction_snapshot.memory` remains a schema/diagnostic section, but S0081 does not use it to carry memory content or policy.

### Automatic Daily

After a completed turn, Scorel appends one short daily entry automatically. The entry is generated from the completed turn evidence and written by the runtime, not by relying on the main assistant to call a tool.

### Automatic Dream

When enabled, Scorel uses the `auxiliary` model after a completed turn to consolidate:

- project `MEMORY.md` from recent turn evidence and current project memory;
- root `MEMORY.md` only for clearly cross-project/stable preferences.

If no auxiliary model is configured or model execution fails, the main turn still succeeds; Scorel writes diagnostics and keeps daily/context memory working.

### GUI Settings

GUI Settings must expose memory controls for the selected project:

- enable memory;
- enable automatic daily;
- enable automatic project dream;
- enable root memory promotion.

The Settings view must be openable with `Command+,` on macOS and `Ctrl+,` elsewhere through the Electron application menu.

## Not In Scope

- Topic memory files.
- Semantic recall selectors.
- Full activity recorder.
- Per-turn vector search.
- Cloud sync.
- Editing memory files in GUI.
- Blocking the user turn on memory consolidation success.

## Acceptance Criteria

- New sessions append a hidden `harness_item kind="memory"` before the user message is assembled into context.
- `buildContext()` surfaces that memory harness as a `<system-reminder>` in `messages[]`.
- Provider `systemPrompt` does not contain root/project/daily memory contents.
- Completed turns automatically append to project daily when memory daily is enabled.
- Completed turns attempt auxiliary consolidation when automatic dream is enabled.
- Project `MEMORY.md` can be updated automatically from completed turn evidence.
- Root `MEMORY.md` can be updated only for stable global preferences, and can be disabled independently.
- Missing config or missing auxiliary model does not fail the user turn.
- GUI Settings renders a Memory section with real controls.
- `Command+,` / `Ctrl+,` opens GUI Settings.

## Testing Requirements

- Unit tests for memory paths, rendering, daily append, and deterministic fallback extraction.
- Config tests for `[memory]` parsing/rendering.
- Daemon tests proving memory harness injection and daily append after a completed turn.
- GUI render tests proving Memory Settings controls are visible.
- Source-level or unit test proving the Electron menu binds `CommandOrControl+,` to Settings.

## Impacted Files

- `packages/core/src/config/index.ts`
- `packages/core/src/memory/*`
- `packages/core/src/index.ts`
- `packages/daemon/src/index.ts`
- `packages/protocol/src/events.ts`
- `packages/protocol/src/wire.ts`
- `packages/client/src/index.ts`
- `apps/gui/src/main.ts`
- `apps/gui/src/main/local-host.ts`
- `apps/gui/src/shared/ipc.ts`
- `apps/gui/src/preload.ts`
- `apps/gui/src/renderer/App.tsx`
- `apps/gui/src/renderer/settings/*`
- tests near the changed modules

## Risks And Boundaries

- Memory can become stale. The harness reminder must tell the model to verify current code facts from the repo.
- Automatic memory must be best-effort. It must not fail the main user turn.
- Root promotion is high-risk. S0081 only promotes clearly global preferences and keeps project facts inside project memory.
- Daily is recent context, not source of truth. Session JSONL remains the authoritative evidence chain.
