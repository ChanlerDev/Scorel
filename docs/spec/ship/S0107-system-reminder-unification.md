# S0107: System Reminder Unification

## Goal

Unify how Scorel represents, persists, projects, and displays system reminders.

The business value is prompt and transcript hygiene: runtime guidance should reach the model through one stable contract, without ad-hoc `<system-reminder>` string construction scattered across daemon, session replay, tool-result merge paths, or future context-control features. UI should consistently hide or display reminder evidence based on explicit visibility, not by parsing model-facing text.

## Scope

### Reminder Source Model

Define one internal reminder representation for model-facing non-user guidance.

Current sources include:

- `harness_item` events such as memory, channel context, skill listing, skill delta, and steer.
- Compact summary messages.
- Model-only metadata attached to a specific `user_message`, such as `snip.userMessageId`.
- Future runtime guidance that should be visible to the model but not necessarily displayed as transcript text.

The new contract must preserve the existing product distinction:

- Some reminders are standalone session events (`harness_item`).
- Some reminders are attached to a specific message to preserve prompt-cache prefix stability.
- Some reminders can merge into a previous `tool_result`.

### Single Renderer

Move `<system-reminder>` wrapping behind a single public core helper or equivalent abstraction. Callers should provide reminder content and placement intent, not hand-write:

```text
<system-reminder>
...
</system-reminder>
```

The renderer must keep the existing prompt contract:

```text
<system-reminder>
content
</system-reminder>
```

Any future format change must happen in one place.

### Visibility And Projection

Clarify and consolidate visibility semantics:

- `harness_item.visibility` controls whether the harness event is displayed as transcript evidence.
- Message-level model-only blocks are included in LLM context but hidden from WebUI and GUI transcript projection.
- Display projectors must not parse `<system-reminder>` text to decide visibility.
- Provider adapters should receive already-rendered model-facing text or a normalized reminder block from core, not duplicate reminder formatting.

### Prompt Cache Stability

Reminder placement must not rewrite older model context on later turns.

For reminders attached to a specific persisted message, the model-facing block must be created when that message is persisted. Later `buildContext()` calls may clone or filter it, but must not mutate historical messages based on later session state.

## Not In Scope

- Changing snip semantics from S0106.
- Replacing `harness_item` with a new event type unless the implementation proves the existing event cannot express the contract.
- Changing provider-level system prompt assembly.
- UI controls for browsing hidden reminders.
- Backfilling or migrating old session JSONL files.
- Renaming `<system-reminder>` in the model-facing prompt.

## Acceptance Criteria

- No daemon or feature code hand-writes `<system-reminder>` strings.
- `buildContext()` uses the shared reminder renderer for `harness_item` and compact summaries.
- Snip's model-only user-message id block uses the shared reminder renderer or normalized reminder block.
- WebUI and GUI hide model-only message blocks without parsing reminder text.
- Existing harness visibility behavior stays intact:
  - hidden harness items do not render as visible turns;
  - display harness items still render as lightweight transcript evidence.
- Prompt-cache stability is preserved for message-attached reminders: replaying the same persisted user message in later provider calls produces the same content.
- Provider adapters do not own system-reminder formatting rules.
- `pnpm typecheck && pnpm test` passes.

## Testing Requirements

- Core session tests for the shared reminder renderer and `buildContext()` conversion.
- Daemon embedded test proving snip's message-attached reminder remains stable across later turns.
- WebUI and GUI projector tests proving model-only blocks are hidden while display harness items remain visible.
- Regression test or static check that common runtime paths no longer hand-write `<system-reminder>` literals outside the shared renderer and tests/docs.

## Impacted Files

- `packages/core/src/session/index.ts`
- `packages/core/src/session/session.test.ts`
- `packages/core/src/tools/index.ts` or a new core reminder module
- `packages/daemon/src/index.ts`
- `packages/daemon/src/embedded/embedded.test.ts`
- `apps/webui/lib/events/projector.ts`
- `apps/webui/lib/events/projector.test.ts`
- `apps/gui/src/renderer/chatbox/projector.ts`
- `apps/gui/src/renderer/chatbox/projector.test.ts`
- `docs/spec/events.md`
- `docs/spec/session.md`
- `README.md`

## Risks And Boundaries

- Reminder placement affects prompt-cache behavior. A cleanup that moves snip ids from persisted user messages into later dynamic `buildContext()` injection would regress S0106.
- Tool-result merge behavior is easy to break. The implementation must preserve valid assistant tool-call / tool-result replay.
- UI should use explicit visibility metadata, not text parsing. Parsing `<system-reminder>` in UI would make display behavior depend on prompt formatting.
- A broader content-block redesign may be attractive, but S0107 should stay focused on unifying reminder construction and projection.
