# V0-M1: Core Loop

> Canonical message model + EventStream + OpenAI adapter + message persistence

## Goal

Complete the minimal chat loop: user sends prompt → OpenAI streams response → persist messages → user sends again. No tools, no compact, no skills.

## Scope

- **Canonical message model**: `UserMessage`, `AssistantMessage`, `ToolResultMessage`, `ScorelMessage` types
- **OpenAI adapter**: `transformMessages()` for OpenAI Chat Completions format
- **EventStream**: normalized `AssistantMessageEvent` stream from OpenAI SSE
- **Streaming delta aggregation**: text content + tool call accumulation (tool execution deferred to M2)
- **Message persistence**: SQLite `messages` table with `seq` ordering + EventLog JSONL dual-write
- **Session management**: create / list / get / rename / archive / delete
- **Provider config**: CRUD for provider configs, `secrets` write-only API for Keychain storage
- **Preload API**: `sessions.*`, `chat.send/abort/onEvent`, `providers.*`, `secrets.*`
- **Electron shell**: BrowserWindow + contextIsolation + sandbox + preload bridge

## Out of Scope (M1)

- Anthropic adapter (→ M1.5)
- Tool execution / approval (→ M2)
- FTS5 search / export (→ M3)
- Compact / skills (→ M4)

## Key Implementation Notes

### Message Persistence

- Messages written to SQLite on `llm.done` event (not during streaming)
- `messages.seq` is monotonically increasing per session — authoritative ordering
- `message_json` stores the full canonical `ScorelMessage` as JSON
- EventLog JSONL is best-effort append (SQLite is source of truth for V0)

### OpenAI Adapter

- `assistant.content` always sent as plain string (join TextParts) — prevents pi #2007
- `compat.supportsDeveloperRole` controls `system` vs `developer` role
- `compat.maxTokensField` controls `max_tokens` vs `max_completion_tokens`
- `stream_options.include_usage: true` for token counting

### Session State Machine (M1 subset)

```
[*] ──▶ idle ──send_prompt──▶ streaming ──stop/length──▶ idle
                                │
                            abort ──▶ idle
                    (persist aborted assistant if visible output)
```

Tool-related states (`awaiting_approval`, `tooling`) are added in M2.

### Provider Onboarding

1. Renderer shows provider config form (baseUrl, model selection)
2. User enters API key → `secrets.store(providerId, key)` (write-only IPC)
3. Key stored in macOS Keychain; `ProviderConfig.auth.keyRef` references it
4. `providers.testConnection(providerId)` validates connectivity
5. No `getSecret` API exists — renderer never receives stored plaintext

## Acceptance Criteria

- [ ] **Case A**: Streaming output + stop + send again (no tools) — works for OpenAI
- [ ] **Case B**: Tool round structure: LLM produces tool_calls in response — correctly parsed and persisted (execution deferred to M2)
- [ ] First streaming token within 3s on normal network
- [ ] Session recoverable after app restart (messages loaded from SQLite by `seq` order)
- [ ] Provider config CRUD works; API key stored in Keychain
- [ ] Abort stops streaming within 500ms; aborted assistant persisted if visible output existed

## Files to Create/Modify

| File | Action |
|------|--------|
| `src/shared/types.ts` | Create: all canonical types (Message, Event, Provider, etc.) |
| `src/shared/events.ts` | Create: ScorelEvent, AssistantMessageEvent types |
| `src/shared/constants.ts` | Create: defaults, limits |
| `src/main/provider/types.ts` | Create: adapter interfaces |
| `src/main/provider/openai-adapter.ts` | Create: OpenAI transform + streaming |
| `src/main/provider/event-stream.ts` | Create: EventStream class |
| `src/main/provider/compat.ts` | Create: ProviderCompat handling |
| `src/main/storage/db.ts` | Create: SQLite setup, WAL, migrations |
| `src/main/storage/event-log.ts` | Create: JSONL append writer |
| `src/main/core/session-manager.ts` | Create: session CRUD |
| `src/main/core/orchestrator.ts` | Create: context assembly + send loop |
| `src/main/security/keychain.ts` | Create: macOS Keychain read/write |
| `src/preload/index.ts` | Create: contextBridge API |
| `src/renderer/` | Create: minimal React shell (chat input + message list) |

## Definition of Done

All acceptance criteria pass. Provider config + streaming chat works end-to-end in Electron. Messages survive app restart.
