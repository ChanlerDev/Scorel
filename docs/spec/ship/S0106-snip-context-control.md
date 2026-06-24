# S0106: Snip Context Control

## Goal

Let long-running sessions remove a completed user turn from future model context without deleting the underlying session record.

The business value is context hygiene: when an earlier user turn led the agent down a noisy or obsolete path, the user or agent can mark that whole turn as no longer relevant so future model calls stop paying attention to it. The original JSONL remains the evidence chain for UI, audit, resync, and debugging.

## Scope

### Stable User Turn References

Every persisted `user_message` already has a durable `EventId`. S0106 treats that event id as the source of truth for snip targeting. The model-facing id is a stable short alias derived from the real `EventId`; the alias resolves back to the real event id but is not a storage key.

When the Host creates a `user_message`, it appends a model-only text block to that same persisted message:

```text
<system-reminder>
snip.userMessageId: u_...
</system-reminder>
```

The block is persisted with the message so future `buildContext()` replays do not rewrite earlier user messages and do not invalidate prompt-cache prefixes. UI projectors hide model-only text blocks from the visible transcript.

### Context Control Event

Add a persistent control event:

```ts
type ContextControlEvent = {
  type: "context_control";
  operation: "hide_user_turn";
  anchorUserEventId: EventId;
  throughEventId: EventId;
  actor: "agent" | "user" | "system";
  reason?: string;
};
```

The event is append-only and does not participate in the conversation tree. `buildContext()` folds these events as control state and filters the active path before producing LLM messages.

`hide_user_turn` semantics:

- `anchorUserEventId` must identify a `user_message` on the active session path.
- The hidden span starts at that user event.
- The hidden span ends at the event before the next `user_message` on the same path, or the active leaf when there is no later user message.
- The resolved end is stored as `throughEventId`.
- The span is hidden from future `buildContext()` calls after the control event is appended.
- Original events stay in JSONL and continue to be visible through session replay and UI projection.

### `snip` Tool

Expose a lazily available `Snip` runtime tool that lets the agent request hiding a completed user turn from future context. The tool accepts:

```json
{ "userMessageId": "u_...", "reason": "optional short reason" }
```

The Host validates the request, resolves the model-visible short alias to a target span, appends a `context_control` event, and returns a brief model-visible confirmation. Internal span details such as `anchorUserEventId`, `throughEventId`, and hidden event count may remain in structured tool result details for diagnostics, but provider context must only receive the concise confirmation. The tool result is still part of the current turn; the hidden span disappears on the next context build.

The tool is session-context control, not a generic coding tool. It must be registered by the Host with access to the current lane, not by `createCodingTools()`.

Tool parameter schemas are owned by `AgentTool` definitions. Provider adapters must pass through the tool's declared schema instead of hard-coding behavior for specific tool names such as `snip`.

## Not In Scope

- Physically deleting, truncating, or rewriting historical JSONL.
- Arbitrary single-message deletion.
- Snipping across branches.
- User-facing GUI controls for browsing snipped spans.
- A CLI slash command.
- Automatic snip heuristics.
- Reusing `compact` for snip. Compact summarizes old context; snip excludes a specific user turn.

## Acceptance Criteria

- `PersistentEvent` includes `context_control`.
- Session replay folds `hide_user_turn` events into control state.
- `buildContext()` excludes the hidden user-turn span from future LLM context.
- The excluded span can include assistant tool calls and tool results without leaving orphan tool results in context.
- JSONL remains append-only; original user/assistant/tool events remain loadable after snip.
- Repeated snip of the same target is idempotent enough to keep context stable.
- Invalid targets fail as tool errors and do not append control events.
- `snip` is registered by the Host and can append `context_control` from a real runtime tool call path.
- The model can discover snippable user turn ids from its normal context projection; tests must not rely on out-of-band `send_message` response data.
- User turn ids are persisted at user-message creation time, so replaying the same turn in later provider calls does not change that message and preserves prompt-cache stability.
- Model-only short id blocks are hidden from WebUI and GUI transcript projection.
- The `snip` `AgentTool` schema exposes `userMessageId` and optional `reason`, and provider adapters preserve tool-owned schemas without name-specific branches.
- Full validation passes with `pnpm typecheck && pnpm test`.

## Testing Requirements

- Core session tests for context-control parsing, replay, and context filtering.
- Protocol tests for exhaustive event handling.
- Daemon embedded test proving `snip` appends `context_control` and the next provider call no longer receives the hidden turn.

## Impacted Files

- `packages/protocol/src/events.ts`
- `packages/protocol/src/index.test.ts`
- `packages/core/src/session/index.ts`
- `packages/core/src/session/session.test.ts`
- `packages/core/src/tools/index.ts`
- `packages/daemon/src/index.ts`
- `packages/daemon/src/embedded/embedded.test.ts`
- `docs/ROADMAP.md`
- `README.md`

## Risks And Boundaries

- Hiding the wrong turn is worse than compacting too much. Target resolution must use real `EventId`s and reject non-user targets.
- Tool-call/tool-result pairing can be broken by arbitrary deletion. This spec only hides full user-turn spans.
- Snip is context projection, not evidence deletion. UI and session replay must still show the original events unless a later explicit product decision adds a separate display filter.
