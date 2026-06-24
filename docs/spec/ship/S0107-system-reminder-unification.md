# S0107: System Reminder Unification

## Goal

Unify Scorel's runtime reminders as structured, model-facing context fragments.

The business value is prompt and transcript hygiene on a high-frequency path. Scorel will routinely attach reminders to user messages, inject reminders while a turn is running, and route reminders through different provider message formats. This must be one stable product contract, not ad-hoc `<system-reminder>` strings scattered across daemon, session replay, tool-result merge paths, UI projectors, or provider adapters.

## Scope

### Structured Reminder Block

Add a protocol-level content block:

```typescript
type SystemReminderKind =
  | "attachment"
  | "time"
  | "message_ref"
  | "skill_listing"
  | "skill_delta"
  | "memory"
  | "channel_context"
  | "steer"
  | "todo_nudge"
  | "runtime_notice"
  | "compact_summary";

type SystemReminderOrigin = "system" | "user" | "tool" | "skill";

type SystemReminderScope =
  | "message"          // travels with one persisted message whenever that message is in context
  | "turn"             // relevant to the user turn that created it
  | "next_model_call"  // runtime nudge, consumed by the next provider call
  | "session";         // durable session context such as initial memory

type SystemReminderVisibility = "model" | "display" | "compact";

interface SystemReminderContentBlock {
  type: "system_reminder";
  kind: SystemReminderKind;
  origin: SystemReminderOrigin;
  text: string;
  visibility: SystemReminderVisibility;
  scope: SystemReminderScope;
  data?: Record<string, unknown>;
}
```

`<system-reminder>` remains the model-facing transport envelope, but it is no longer stored or hand-written by feature code. Callers create structured reminder blocks; core/provider projection renders the envelope.

### Two Placement Modes

System reminders can appear in two product situations:

1. **Message-attached reminders**: created together with a `user_message` and persisted in that message's `content`.
   - Examples: current time for the submitted turn, `snip.userMessageId`, references to prior user messages, channel context that explains the submitted text.
   - These are stable sidecars. They are created when the message is persisted, so replaying the same message later does not mutate historical content or break prompt-cache prefix stability.

2. **Runtime injected reminders**: appended while a turn is running or between provider calls.
   - Examples: steer, skill delta, a nudge that the model has not used `TodoWrite`, runtime notices.
   - These remain standalone `harness_item` events because they are independent session facts. `buildContext()` lowers them into structured reminder blocks and then places them according to provider-safe rules.

### Canonical Context And Provider Lowering

Scorel keeps a provider-neutral context:

- `ScorelMessage.content` may contain `system_reminder` blocks.
- UI/display projectors use block type and `visibility`; they must not parse `<system-reminder>` text.
- Provider adapters receive canonical `ScorelMessage[]` and lower `system_reminder` blocks to the provider's legal representation.

Default lowering keeps the current prompt contract:

```xml
<system-reminder>
content
</system-reminder>
```

Provider placement rules:

- User-message sidecars are rendered inside the same user message after visible user text.
- Runtime reminders prefer merge-after-tool-result when a valid previous tool result exists.
- If a provider cannot legally merge after a tool result, fallback to a standalone user message immediately after the tool result batch.
- Provider-level system/developer prompt is not used for runtime reminders.

### Core Helper Surface

Core owns reminder construction and rendering:

- `createSystemReminderBlock(input)`
- `renderSystemReminder(block | text)`
- `renderSystemReminderText(text)`
- `appendSystemReminderToToolResult(message, block)`
- `systemReminderMessage(block, meta?)`

Feature code must pass semantic fields: `kind`, `origin`, `scope`, `visibility`, `text`, optional `data`. Feature code must not write `<system-reminder>` tags.

### Existing Source Migration

Migrate these sources to structured reminder blocks:

- `snip.userMessageId` model-only block attached to every persisted user message.
- `harness_item` conversion for memory, channel context, skill listing, skill delta, steer, runtime notice, and future todo nudges.
- compact summary injection.
- GUI and WebUI transcript projection for model-only blocks.

`harness_item` remains the persistent event for standalone runtime/session injections. S0107 does not need a new event type unless the implementation proves `harness_item` cannot carry the contract.

## Not In Scope

- Changing `snip` behavior from S0106.
- Adding UI controls for browsing hidden reminders.
- Backfilling or migrating old session JSONL files.
- Renaming `<system-reminder>` in the model-facing prompt.
- Moving runtime reminders into provider-level system/developer prompts.
- Replacing all event-type conversion with a full handler registry.

## Acceptance Criteria

- Protocol supports `system_reminder` content blocks.
- No daemon or feature code hand-writes `<system-reminder>` strings.
- `buildContext()` uses shared core helpers for `harness_item` and compact summary conversion.
- `snip.userMessageId` is a message-attached `system_reminder` block with stable prompt-cache behavior across later turns.
- Provider adapters lower `system_reminder` blocks through the shared renderer, including reminders inside user messages and merged tool results.
- WebUI and GUI hide model-only reminder blocks without parsing reminder text.
- Existing harness visibility behavior stays intact:
  - hidden harness items do not render as visible transcript turns;
  - display/compact harness items can still render as lightweight transcript evidence.
- `pnpm typecheck && pnpm test` passes.

## Testing Requirements

- Protocol tests for `system_reminder` content block round trip / exhaustiveness.
- Core session tests for:
  - message-attached reminder blocks rendering to `<system-reminder>` in provider context;
  - `harness_item` conversion producing structured reminder blocks;
  - merge-after-tool-result behavior preserving tool result content;
  - compact summary using the shared reminder renderer.
- Daemon embedded test proving snip's message-attached reminder remains stable across later turns.
- Provider adapter test proving `system_reminder` blocks are lowered to `<system-reminder>` text.
- WebUI and GUI projector tests proving model-only reminder blocks are hidden while display harness items remain visible.
- Static regression check that common runtime paths no longer hand-write `<system-reminder>` literals outside tests/docs and the shared renderer.

## Impacted Files

- `packages/protocol/src/messages.ts`
- `packages/protocol/src/index.test.ts`
- `packages/core/src/session/index.ts`
- `packages/core/src/session/session.test.ts`
- `packages/core/src/provider/pi-ai.ts`
- `packages/core/src/provider/pi-ai.test.ts`
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

- Reminder placement affects prompt-cache behavior. Do not move message-attached reminders into dynamic `buildContext()` injection.
- Tool-result merge behavior must preserve valid assistant tool-call / tool-result replay.
- Runtime reminders can be frequent. The data model must keep origin, kind, scope, and visibility explicit so future skill, time, todo, IM, and provider-specific rules do not become string parsing.
- UI must use explicit metadata, not text parsing.
- A full event handler registry remains a later refactor; S0107 should ship the stable reminder contract first.

## Status

Done.
