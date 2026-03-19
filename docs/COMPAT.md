# Scorel Compatibility Strategy

This document defines the canonical message model invariants, provider adapter mappings, compatibility pitfalls, and regression test contracts.
It is a **living document** — update it whenever a new provider or OpenAI-compatible backend reveals new behavior.

## 1. Canonical Message Model Invariants

Scorel uses a **canonical message model** internally (`ScorelMessage`). Provider adapters transform canonical messages to/from provider-specific formats via `transformMessages()`.

### Core invariants

| Invariant | Rule |
|-----------|------|
| System prompt | Assembled per-request from instruction layers; never stored as a message |
| `assistant.content` (OpenAI) | Always sent as plain string, not content-part array (prevents pi #2007 recursive nesting) |
| `assistant.content` (Anthropic) | Sent as content block array (`text`, `tool_use`, optionally `thinking`) |
| Tool result | Canonical `role: "toolResult"` — adapted to `role: "tool"` (OpenAI) or `tool_result` block inside `role: "user"` (Anthropic) |
| Aborted assistant | Persisted with `stopReason: "aborted"` if visible output existed; **excluded** from outbound provider payload |
| Orphan tool result | Kept in storage; **excluded** from outbound provider payload |
| Message ordering | `messages.seq` (monotonic per session) is authoritative; `ts` is informational |
| Tool call IDs | Canonical IDs stored as-is; adapters may normalize (e.g., Anthropic 64-char limit) |

## 2. Provider Adapter Mappings

### OpenAI Chat Completions

| Canonical | OpenAI Format |
|-----------|--------------|
| System prompt | `role: "system"` or `role: "developer"` message (per `compat.supportsDeveloperRole`) |
| `UserMessage` | `role: "user"`, `content: string` |
| `AssistantMessage` | `role: "assistant"`, `content: string` (joined TextParts; content-part array prohibited by default) |
| `AssistantMessage` tool calls | `tool_calls: [{ id, function: { name, arguments } }]` |
| `ToolResultMessage` | `role: "tool"`, `tool_call_id`, `content: string` |
| `ThinkingPart` | Converted to text if `compat.requiresThinkingAsText`, otherwise omitted |
| Streaming | SSE `data: {...}` lines, `finish_reason` in final chunk |
| Stop reasons | `stop` → `stop`, `length` → `length`, `tool_calls` → `toolUse` |

### Anthropic Messages

| Canonical | Anthropic Format |
|-----------|-----------------|
| System prompt | Top-level `system` parameter (NOT a message role) — extracted and merged from instruction layers |
| `UserMessage` | `role: "user"`, `content: [{ type: "text", text }]` |
| `AssistantMessage` | `role: "assistant"`, `content: [text blocks + tool_use blocks]` |
| `AssistantMessage` tool calls | `{ type: "tool_use", id, name, input }` content blocks |
| `ToolResultMessage` | `{ type: "tool_result", tool_use_id, content }` block inside a `role: "user"` message |
| `ThinkingPart` | `{ type: "thinking", thinking, signature? }` block (preserved if same model; converted to text if cross-provider) |
| Streaming | SSE events: `message_start`, `content_block_start`, `content_block_delta`, `content_block_stop`, `message_delta`, `message_stop` |
| Stop reasons | `end_turn` → `stop`, `max_tokens` → `length`, `tool_use` → `toolUse` |

### Anthropic Ordering Rules (V0 must enforce)

1. **System extraction**: All system/developer instructions must be extracted from messages and passed as the top-level `system` parameter. No `role: "system"` messages in `messages[]`.
2. **Tool result grouping**: `tool_result` blocks must be inside `role: "user"` messages, not standalone messages.
3. **Tool result ordering**: Within a `user` message, all `tool_result` blocks must come **before** any freeform text blocks.
4. **Immediate follow**: `tool_result` blocks must immediately follow the corresponding `tool_use` turn in the message sequence.
5. **Tool call ID normalization**: Anthropic limits `tool_use_id` to 64 characters. IDs exceeding this are deterministically shortened (e.g., `tc_` + SHA-256 prefix). The mapping is adapter-local; canonical storage keeps original IDs.
6. **Message alternation**: Messages must strictly alternate `user` / `assistant` roles. Consecutive same-role messages must be merged or bridged.

Violating rules 1-4 → Anthropic returns 400 `invalid_request_error`. The adapter validates and auto-reorders before sending.

## 3. ProviderCompat Fields (OpenAI-compatible backends)

```ts
export type ProviderCompat = {
  // Use "developer" role instead of "system" for instructions
  supportsDeveloperRole?: boolean;           // default: false

  // Which field name for max output tokens
  maxTokensField?: "max_completion_tokens" | "max_tokens";  // default: "max_tokens"

  // Some backends require tool_result messages to include tool name
  requiresToolResultName?: boolean;          // default: false

  // Some backends require an assistant message between tool_result and next user message
  requiresAssistantAfterToolResult?: boolean; // default: false

  // Backends that don't support thinking blocks: convert to text
  requiresThinkingAsText?: boolean;          // default: false
};
```

Each field maps to a specific transformation in the adapter layer.
New compat flags should be added here as new backends reveal new quirks.

**Scope**: These compat flags apply to OpenAI-compatible backends only. Anthropic differences are structural (handled by the Anthropic adapter), not quirks. Do not represent Anthropic core behavior as compat flags.

## 4. Known Pitfalls (Pitfall Registry)

### PIT-001: assistant.content recursive nesting

- **Source**: pi issue #2007
- **Symptom**: When assistant.content is sent as content-part array (`[{type:"text",text:"..."}]`), some OpenAI-compatible backends mirror the structure back, causing recursive nesting on subsequent turns
- **Impact**: Context grows exponentially; session becomes unusable within a few turns
- **Mitigation**: V0 always sends `assistant.content` as plain string (join all TextPart). Reserve `compat.allowContentPartArray` flag (default: false)
- **Regression test**: Case C — send content-part array to mock backend that mirrors structure; verify V0 normalizes to string

### PIT-002: orphan toolResult after abort

- **Source**: pi issue #1033 and related transform-messages bugs
- **Symptom**: When streaming is aborted mid-tool-call, the errored/aborted assistant message gets skipped in history, leaving a toolResult with no matching toolCall
- **Impact**: Anthropic rejects with 400; OpenAI may produce confused output
- **Mitigation**: V0 persists aborted assistant with `stopReason: "aborted"` if visible output existed (otherwise event-only). Aborted assistants are **excluded from outbound provider payload** but kept in storage and EventLog. Orphan toolResults are also excluded from outbound payload but kept in storage. UI shows them grayed/with warning banner.
- **Regression test**: Case D — abort during tool execution; verify no orphan toolResult in next request payload

### PIT-003: tool_result name requirement

- **Source**: Some OpenAI-compatible backends (not official OpenAI)
- **Symptom**: Backend rejects tool result message if `name` field is missing
- **Impact**: Tool loop breaks silently
- **Mitigation**: `compat.requiresToolResultName` — when true, adapter adds `name` field to tool result messages
- **Regression test**: Mock backend that validates name field presence

### PIT-004: missing assistant bridge after tool_result

- **Source**: Certain self-hosted backends
- **Symptom**: Backend expects an assistant message between tool_result and next user message
- **Impact**: 400 error or garbled output
- **Mitigation**: `compat.requiresAssistantAfterToolResult` — when true, adapter inserts a synthetic empty assistant message
- **Regression test**: Mock backend that enforces this ordering

### PIT-005: max_tokens vs max_completion_tokens

- **Source**: OpenAI API evolution (newer models use `max_completion_tokens`)
- **Symptom**: Using wrong field name causes it to be silently ignored; model may produce truncated or unexpectedly long output
- **Impact**: Unpredictable output length
- **Mitigation**: `compat.maxTokensField` selects the correct field name per provider config
- **Regression test**: Verify correct field appears in request payload for each provider config

### PIT-006: Anthropic system prompt as message role

- **Source**: Anthropic Messages API design
- **Symptom**: Sending `role: "system"` in `messages[]` → 400 error
- **Impact**: Request rejected
- **Mitigation**: Adapter extracts all system/developer content and passes as top-level `system` parameter
- **Regression test**: Verify no `role: "system"` messages in Anthropic outbound payload

### PIT-007: Anthropic tool_result ordering violation

- **Source**: Anthropic Messages API
- **Symptom**: `tool_result` blocks not immediately after corresponding `tool_use`, or freeform text before `tool_result` in same user message → 400 error
- **Impact**: Tool loop breaks
- **Mitigation**: Adapter validates and auto-reorders tool_result blocks within user messages; tool_result blocks placed before text blocks
- **Regression test**: Build a message sequence with out-of-order tool_results; verify adapter fixes ordering

### PIT-008: Tool call ID exceeds Anthropic 64-char limit

- **Source**: OpenAI tool_call IDs can be 450+ characters; Anthropic limits to 64
- **Symptom**: Anthropic rejects requests with overly long tool_use_id
- **Impact**: Cross-provider sessions break when switching from OpenAI to Anthropic
- **Mitigation**: Deterministic ID shortening in Anthropic adapter (`tc_` + SHA-256 hex prefix, 64 chars total). Mapping is adapter-local; storage keeps canonical IDs. Same mapping applied to both outbound `tool_use.id` and `tool_result.tool_use_id`
- **Regression test**: Send a message with 200-char tool_call_id through Anthropic adapter; verify shortened ID is consistent and round-trips correctly

### PIT-009: Thinking blocks lost in cross-provider transfer

- **Source**: Cross-provider message conversion
- **Symptom**: Claude's thinking blocks sent to OpenAI cause errors or are silently dropped
- **Impact**: Lost reasoning context when switching providers mid-session
- **Mitigation**: `transformMessages()` converts thinking blocks to plain text when target provider differs from source. If same provider+model, preserve thinking signature for cache reuse
- **Regression test**: Claude response with ThinkingPart → transform for OpenAI → verify converted to TextPart

### PIT-010: Anthropic rejects orphan tool_result

- **Source**: Anthropic Messages API strict validation
- **Symptom**: `tool_result` without matching `tool_use` in prior assistant message → 400 error
- **Impact**: Session unusable after abort that produced orphan
- **Mitigation**: `transformMessages()` excludes orphan tool_results from outbound payload; logs validation_warning event
- **Regression test**: Construct message history with orphan tool_result; verify excluded from Anthropic payload

## 5. Conversion Guarantee Matrix

| Scenario | Risk | V0 Strategy | Test |
|----------|------|-------------|------|
| OpenAI tool_calls multi-step loop | Forget to feed back tool output → model can't continue | Strictly follow tool calling flow | E2E: at least 1 tool round |
| OpenAI streaming abort | Produces half-baked assistant, pollutes history | Persist with `stopReason=aborted`, exclude from outbound | Unit: abort then replay produces no orphan or aborted assistant in context |
| OpenAI content structure compat | Some backends mirror structure recursively | assistant.content forced to string | Regression: pi #2007 pattern |
| Anthropic system extraction | system in messages → 400 | Adapter extracts to top-level param | Unit: no system role in Anthropic payload |
| Anthropic tool_result regroup | Standalone tool role → 400 | Adapter regroups into user message | Unit: tool_results inside user messages |
| Anthropic tool_result ordering | Text before tool_result in user msg → 400 | Adapter reorders within user message | Unit: tool_result blocks precede text |
| Anthropic tool_call_id length | >64 char ID → rejection | Deterministic shortening | Unit: long ID shortened consistently |
| Cross-provider thinking blocks | ThinkingPart to wrong provider → error | Convert to text for different provider | Unit: thinking → text for OpenAI |
| Orphan toolResult (cross-protocol) | toolResult without matching toolCall → 400 | Exclude from outbound payload | Regression: pi #1033 pattern |
| Manual compact boundary | Post-compact resume must use summary + tail | Compactions table, boundary_message_id | Integration: compact → resume → correct context |

## 6. Adding a New Pitfall

When you discover a new compatibility issue:

1. Assign the next `PIT-XXX` number
2. Document: Source, Symptom, Impact, Mitigation, Regression test
3. If mitigation requires a new compat flag, add it to `ProviderCompat` type
4. Write the regression test BEFORE deploying the fix
5. Update the Conversion Guarantee Matrix if the pitfall affects a listed scenario
