# V0-M1.5: Anthropic Adapter Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Anthropic Messages as a second provider, validating the canonical message model + adapter abstraction works for a structurally different API.

**Architecture:** Refactor `transformMessages()` to a dual-path pipeline (OpenAI path signature unchanged, new Anthropic path). Add `pushThinkingDelta()` to EventStreamAccumulator. Create `anthropic-adapter.ts` using shared SSE parsing. Wire into provider map.

**Tech Stack:** TypeScript strict, node:crypto for SHA-256, Vitest, existing fetch-based streaming

---

## Chunk 1: Transform Pipeline + Anthropic Message Types

### Task 1: Anthropic types in transform-messages.ts

**Files:**
- Modify: `src/main/provider/transform-messages.ts`
- Test: `tests/unit/transform-messages.test.ts`

#### Steps:

- [ ] **Step 1:** Add Anthropic message types and `normalizeToolCallId()` to `transform-messages.ts`. Add `transformMessagesAnthropic()` export.

Anthropic types:
```ts
export type AnthropicContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean }
  | { type: "thinking"; thinking: string; signature?: string };

export type AnthropicMessage =
  | { role: "user"; content: AnthropicContentBlock[] }
  | { role: "assistant"; content: AnthropicContentBlock[] };

export type AnthropicPayload = {
  system: string;
  messages: AnthropicMessage[];
};
```

`normalizeToolCallId()`:
```ts
import { createHash } from "node:crypto";
export function normalizeToolCallId(id: string): string {
  if (id.length <= 64) return id;
  const hash = createHash("sha256").update(id).digest("hex").slice(0, 61);
  return `tc_${hash}`;
}
```

`transformMessagesAnthropic(systemPrompt, messages, sourceModel?)`:
1. Extract system prompt → `system` field (no system role in messages)
2. Build validToolCallIds (same logic as OpenAI path)
3. Skip aborted assistants, skip orphan toolResults
4. Convert assistant → `{ role: "assistant", content: [text/tool_use/thinking blocks] }`
   - ThinkingPart: if same model → preserve as `{ type: "thinking" }`; else → `{ type: "text" }`
   - ToolCallPart: `{ type: "tool_use", id: normalizeToolCallId(id), name, input }`
5. Convert toolResult → `{ type: "tool_result", tool_use_id: normalizeToolCallId(id) }` inside a user message
   - tool_result blocks BEFORE text blocks within same user message
6. Enforce strict user/assistant alternation:
   - Consecutive user messages → merge into one
   - Consecutive assistant messages → merge content arrays
   - If first message is assistant → insert empty user bridge

- [ ] **Step 2:** Write tests for `transformMessagesAnthropic()` — all 6 Anthropic ordering rules + ID normalization + thinking conversion. Run existing 16 OpenAI tests to confirm no breakage.

Tests to write:
1. Basic user + assistant text turn
2. System prompt extracted to top-level (no system role in messages)
3. Tool round: assistant tool_use → user tool_result (regrouped) → assistant text
4. Tool result ordering: tool_result blocks before text in user message
5. Tool call ID normalization: 200-char ID shortened consistently, same hash on both sides
6. Short IDs (<= 64 chars) pass through unchanged
7. Aborted assistant excluded
8. Orphan toolResult excluded
9. Message alternation: consecutive users merged
10. Message alternation: consecutive assistants merged
11. ThinkingPart preserved for same model (Anthropic → Anthropic)
12. ThinkingPart converted to text for cross-provider
13. Redacted thinking omitted
14. Empty system prompt → empty string in payload (not omitted — Anthropic allows it)

- [ ] **Step 3:** Run all tests: `npx vitest run`

- [ ] **Step 4:** Commit: `feat(provider): add Anthropic transform pipeline with ordering rules`

---

## Chunk 2: EventStreamAccumulator + thinking support

### Task 2: Add `pushThinkingDelta()` to EventStreamAccumulator

**Files:**
- Modify: `src/main/provider/event-stream.ts`
- Test: `tests/unit/openai-adapter.test.ts` (add thinking tests)

#### Steps:

- [ ] **Step 1:** Add `pushThinkingDelta(delta)` and block-index tracking to `EventStreamAccumulator`.

The accumulator needs:
- `_openThinkingIndex: number | null` — same pattern as `_openTextIndex`
- `pushThinkingDelta(delta)` — accumulate thinking text, emit `thinking_delta` events
- `_closeThinking()` — emit `thinking_end`, reset index
- Close open thinking before text or tool calls start (same as text/tool transitions)
- On finalize: close open thinking, include ThinkingPart in content
- On abort: discard incomplete thinking (same as tool calls)

- [ ] **Step 2:** Write tests for thinking delta accumulation:
1. Thinking-only stream → ThinkingPart in content
2. Thinking then text → both parts in content
3. Thinking then tool calls → thinking + toolCall parts
4. Events emitted: thinking_delta, thinking_end in correct order
5. Abort discards incomplete thinking

- [ ] **Step 3:** Run all tests: `npx vitest run`

- [ ] **Step 4:** Commit: `feat(event-stream): add thinking delta support to accumulator`

---

## Chunk 3: Shared SSE parsing + Anthropic adapter

### Task 3: Extract shared SSE line parser, create Anthropic adapter

**Files:**
- Modify: `src/main/provider/openai-adapter.ts` — extract `parseSSEStream` to shared
- Create: `src/main/provider/anthropic-adapter.ts`
- Test: `tests/unit/anthropic-adapter.test.ts`

#### Steps:

- [ ] **Step 1:** Extract `parseSSEStream()` from `openai-adapter.ts` into a shared helper.

Move to `event-stream.ts` as `parseSSELines()`:
```ts
export async function parseSSEStream(
  response: Response,
  signal: AbortSignal | undefined,
  onEvent: (eventType: string | null, data: string) => void,
): Promise<void>
```
Returns both `event:` type and `data:` payload. OpenAI adapter calls it ignoring event type. Anthropic adapter uses event type for dispatch.

Update `openai-adapter.ts` to import and use the shared parser.

- [ ] **Step 2:** Create `anthropic-adapter.ts`:

```ts
export const anthropicAdapter: ProviderAdapter = {
  api: "anthropic-messages",
  async stream(config, apiKey, opts, onEvent) { ... }
};
```

Key behaviors:
- Build request: POST `{baseUrl}/messages` with `model`, `max_tokens`, `system`, `messages`, `tools` (Anthropic tool format: `name`, `description`, `input_schema`), `stream: true`
- Auth: `x-api-key` header + `anthropic-version: 2023-06-01`
- SSE dispatch by event type:
  - `message_start` → accumulator start (extract usage from message.usage if present)
  - `content_block_start` → track block type/index; if tool_use, capture id+name
  - `content_block_delta` → dispatch to `pushTextDelta`/`pushToolCallDelta`/`pushThinkingDelta` based on block type
  - `content_block_stop` → close current block
  - `message_delta` → capture `stop_reason`, update usage
  - `message_stop` → finalize
- Stop reason mapping: `end_turn` → `stop`, `max_tokens` → `length`, `tool_use` → `tool_calls` (for finalize compatibility)
- Error response: surface Anthropic error JSON clearly
- Anthropic tool format conversion from `ToolDefinition`:
  ```ts
  { name, description, input_schema: parameters }  // not wrapped in `function`
  ```

- [ ] **Step 3:** Write tests for Anthropic adapter SSE parsing (unit tests with mock Response):
1. Text-only streaming turn (Case E)
2. Tool round: tool_use → tool_result → final text (Case F mapping)
3. Thinking block streaming
4. Error handling: non-200 response surfaces error

- [ ] **Step 4:** Run all tests: `npx vitest run`

- [ ] **Step 5:** Commit: `feat(provider): add Anthropic adapter with SSE streaming`

---

## Chunk 4: Wire into provider map

### Task 4: Register Anthropic adapter in provider map

**Files:**
- Modify: `src/main/index.ts`
- Modify: `src/main/ipc-handlers.ts`

#### Steps:

- [ ] **Step 1:** Add `anthropicAdapter` import and `else if (config.api === "anthropic-messages")` branch in both `buildProviderMap()` (index.ts) and `rebuildProviderEntry()` (ipc-handlers.ts).

- [ ] **Step 2:** Run all tests: `npx vitest run`

- [ ] **Step 3:** Commit: `feat(provider): wire Anthropic adapter into provider map`
