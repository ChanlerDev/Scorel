# Scorel V0 Specification

## 1. Product Positioning

Scorel V0 is a **single-user, local-first, desktop agent client** that completes the minimal loop:
conversation (streaming) → tool calls (bash/read/write/edit) → result feedback → session persistence & search → manual compact for long sessions.

V0 does NOT aim to be a universal platform. It aims to be a stable, usable desktop agent client.

## 2. Core User Scenarios

| # | Scenario | Flow |
|---|----------|------|
| S1 | First launch | Configure Provider (baseUrl + key + model) → send message (streaming) → trigger tool → feedback → complete one round |
| S2 | Coding | `read_file` to view → `edit_file` to modify → `bash` to run tests → LLM iterates based on results |
| S3 | Long session | Multiple tool outputs cause bloat → micro_compact silently replaces old tool_result → user triggers manual compact when needed |
| S4 | Skills | User asks "do X per spec" → model calls `load_skill` → reads SKILL.md → executes per skill instructions |

## 3. Scope

### In-Scope (V0 must implement)

- **Provider**: OpenAI Chat Completions (including OpenAI-compatible baseUrl) + Anthropic Messages
  - `messages[]`, `tools[]`, `tool_choice`, SSE streaming (`stream: true`), `stream_options.include_usage`
- **Unified message model**: aligned with pi-ai's `Message = UserMessage | AssistantMessage | ToolResultMessage`
- **Tools**: 4 built-in tools (bash / read_file / write_file / edit_file)
  - Tool loop: request model → receive tool_calls → execute → append tool_result → request again → final response
- **Sessions**: create / resume / rename / archive / delete; abort (stop generation); export (JSONL + Markdown)
- **History & Search**: SQLite + FTS5 (keyword search)
- **Compact**: micro_compact (per-turn: replace old tool_result content with placeholder) + manual compact (user-triggered summary)
- **Skills**: two-layer injection
  - Layer 1: system prompt lists skill name + description (cheap)
  - Layer 2: model calls `load_skill(name)` → SKILL.md body injected as tool_result (expensive, on-demand)
- **Provider adapter layer**: `transformMessages()` for cross-provider message conversion; normalized `AssistantMessageEvent` stream

### Out-of-Scope (V0 explicit TODO / Post-V0)

- MCP (reserve extension points in design; MCP standard transports are stdio + Streamable HTTP, encoding JSON-RPC)
- Semantic search / vector index (embedding pipeline deferred to V1)
- auto_compact and handoff (state machine placeholder + grayed UI entry only)
- Complex permission DSL (command-level allow/deny + path scope is sufficient)
- Plugin ecosystem, team collaboration, multi-window concurrent write conflict resolution

## 4. MVP Acceptance Criteria

| Module | Quantified Criteria |
|--------|-------------------|
| Chat + Streaming | 95%+ sessions show first streaming token within 3s (normal network); UI stops appending within 500ms after abort |
| Provider compat | Both OpenAI and Anthropic complete at least 1 text-only streaming turn + 1 tool round; `transformMessages()` passes ordering/extraction unit tests |
| Tool loop | Cover at least 1 tool round: LLM produces tool_calls → execute → second request gets final reply |
| Permission | write/edit/bash require confirmation each time; read allowed by default; denial feeds error tool_result back to model |
| Persistence | Session recoverable: can resume after restart; export JSONL and Markdown (includes messages + tool calls/results) |
| Search | FTS search at 10k message scale: keyword query < 200ms (local SSD) |
| Compact | micro_compact effective: old tool_result replaced by placeholder; manual compact generates summary and preserves transcript (recoverable) |

## 5. Architecture

### System Components

```
Renderer UI ──IPC via preload──▶ Main/Core Orchestrator
                                    │
                        ┌───────────┼───────────┐
                        ▼           ▼           ▼
                   SQLite+FTS5  EventLog    Runner Process
                                 JSONL      (stdio JSONL)
                        │
                        ▼
                  Provider Registry
                  ├── OpenAI Adapter
                  └── Anthropic Adapter
                        │
                        ▼
              transformMessages() + EventStream
                        │
                  ┌─────┴──────┐
                  ▼            ▼
           OpenAI Chat    Anthropic
           Completions    Messages
```

- **Renderer**: Pure UI, no direct access to keys / filesystem / system commands
- **Main/Core**: Orchestrator (context assembly, protocol calls, permission approval, DB writes, compact)
- **Preload**: `contextBridge` exposes minimal IPC API (Electron best practice)
- **Runner**: Isolated process (stdio JSONL), executes bash/read/write/edit; Core handles approval via hooks

### Electron Security Baseline (V0 mandatory)

- `contextIsolation: true` + renderer sandbox enabled
- Preload + contextBridge exposes minimal API; renderer does NOT run Node
- Keys stored in macOS Keychain; renderer never reads plaintext

### Workspace Model

A **workspace** is a directory on the local filesystem that Scorel operates within. All file tools are scoped to it.

- Configured at session creation (or inherited from app-level default)
- Stored in `sessions.workspace_root` as a first-class column (NOT in settings_json)
- All `read_file` / `write_file` / `edit_file` paths resolved relative to workspace root; paths escaping root are rejected
- `bash` commands execute with `cwd` set to workspace root
- V0: single workspace per session; no workspace switching mid-session
- Default workspace: none — user must explicitly select a workspace directory via folder picker at session creation (no implicit home directory default)
- Rationale: auto-allowing `read_file` within workspace means the workspace boundary IS the security boundary; defaulting to `~` would expose SSH keys, cloud credentials, dotfiles, etc.

### Context Assembly & System Prompt

The Orchestrator assembles context in three layers:

```
Layer 1: Instruction (per-request, stateless)
  ├── Base instructions (app-level, hardcoded)
  ├── Session-level pinned prompt (from sessions.pinned_system_prompt)
  ├── Skill metadata list (name + description for each registered skill)
  └── Workspace context (current workspace root path)

Layer 2: Compact (optional, when manual compact has been triggered)
  └── Latest compact summary text (from compactions table)

Layer 3: Working set (messages after compact boundary, or all messages if no compact)
  ├── UserMessage → role: "user", content: string
  ├── AssistantMessage → role: "assistant", content (see provider-specific transform)
  ├── ToolResultMessage → role: "tool"/"user" (provider-dependent), tool_call_id, content
  ├── Aborted assistants (stopReason: "aborted") EXCLUDED from outbound payload
  ├── Orphan tool results EXCLUDED from outbound payload
  └── micro_compact applied to active tail (KEEP_RECENT=3 turns)
```

Layer 1 becomes `system`/`developer` message (OpenAI) or top-level `system` parameter (Anthropic).
Layer 2+3 are passed through `transformMessages(api)` which handles provider-specific formatting.

Tools array (5 tools: bash, read_file, write_file, edit_file, load_skill) and `tool_choice: "auto"` are appended to the request.

### Streaming Delta Aggregation

OpenAI SSE streaming sends incremental deltas that must be aggregated into a complete `AssistantMessage`:

**Text content**: concatenate `choices[0].delta.content` strings across chunks.

**Tool calls**: non-trivial — a single tool_call is spread across multiple chunks:
- First chunk: `delta.tool_calls[i].id`, `delta.tool_calls[i].function.name` (may be partial)
- Subsequent chunks: `delta.tool_calls[i].function.arguments` (JSON string fragments)
- Aggregation: accumulate by `tool_calls[i].index`; concatenate `function.name` and `function.arguments` strings; parse `arguments` as JSON only after stream completes

**Boundary conditions**:
- `finish_reason: "tool_calls"` signals all tool_calls are complete → parse accumulated arguments JSON
- `finish_reason: "stop"` or `"length"` → finalize text content
- Stream interrupted (network error / abort): mark message `stopReason: "aborted"`, discard incomplete tool_calls (do NOT attempt to parse partial JSON arguments)
- `[DONE]` sentinel: stream complete, finalize AssistantMessage and persist

**V0 implementation**: single accumulator object per streaming response, keyed by `tool_calls[].index`. No parallel stream support (one active stream per session).

### Normalized Event Stream (AssistantMessageEvent)

Both OpenAI SSE and Anthropic SSE are normalized into a canonical `AssistantMessageEvent` stream:

```ts
type AssistantMessageEvent =
  | { type: "start"; partial: AssistantMessage }
  | { type: "text_start"; contentIndex: number; partial: AssistantMessage }
  | { type: "text_delta"; contentIndex: number; delta: string; partial: AssistantMessage }
  | { type: "text_end"; contentIndex: number; content: string; partial: AssistantMessage }
  | { type: "thinking_start"; contentIndex: number; partial: AssistantMessage }
  | { type: "thinking_delta"; contentIndex: number; delta: string; partial: AssistantMessage }
  | { type: "thinking_end"; contentIndex: number; content: string; partial: AssistantMessage }
  | { type: "toolcall_start"; contentIndex: number; partial: AssistantMessage }
  | { type: "toolcall_delta"; contentIndex: number; delta: string; partial: AssistantMessage }
  | { type: "toolcall_end"; contentIndex: number; toolCall: ToolCallPart; partial: AssistantMessage }
  | { type: "done"; reason: StopReason; message: AssistantMessage }
  | { type: "error"; reason: "aborted" | "error"; error: AssistantMessage };
```

Each event carries a `partial` — the accumulated `AssistantMessage` up to that point. Adapters are responsible for converting provider-specific SSE into this canonical stream. UI and persistence consume only canonical events.

### Preload API (Renderer ↔ Main IPC Contract)

```ts
// Exposed via contextBridge as window.scorel
interface ScorelBridge {
  // Sessions
  sessions: {
    create(opts: { providerId: string; modelId: string; workspaceRoot?: string }): Promise<{ sessionId: string }>;
    list(opts?: { archived?: boolean }): Promise<SessionSummary[]>;
    get(sessionId: string): Promise<SessionDetail>;
    rename(sessionId: string, title: string): Promise<void>;
    archive(sessionId: string): Promise<void>;
    delete(sessionId: string): Promise<void>;
    export(sessionId: string, format: "jsonl" | "markdown"): Promise<{ filePath: string }>;
  };

  // Chat
  chat: {
    send(sessionId: string, text: string): Promise<void>;
    abort(sessionId: string): Promise<void>;
    onEvent(sessionId: string, callback: (event: ScorelEvent) => void): () => void; // returns unsubscribe
  };

  // Tools
  tools: {
    approve(toolCallId: string): Promise<void>;
    deny(toolCallId: string, reason?: string): Promise<void>;
  };

  // Compact
  compact: {
    manual(sessionId: string): Promise<void>;
  };

  // Providers
  providers: {
    list(): Promise<ProviderConfig[]>;
    upsert(config: ProviderConfig): Promise<void>;
    delete(providerId: string): Promise<void>;
    testConnection(providerId: string): Promise<{ ok: boolean; error?: string }>;
  };

  // Secrets (write-only)
  secrets: {
    store(providerId: string, secret: string): Promise<void>;
    has(providerId: string): Promise<boolean>;
    clear(providerId: string): Promise<void>;
  };

  // Search
  search: {
    query(text: string, opts?: { sessionId?: string; limit?: number }): Promise<SearchResult[]>;
  };
}
```

This is the ONLY surface area between Renderer and Main. No raw IPC channels.

### Session State Machine

```
                    ┌──────────────────────────────────┐
                    ▼                                  │
[*] ──▶ idle ──send_prompt──▶ streaming                │
                                │         │            │
                  finish=toolUse     finish=stop/length│
                                │         │            │
                                ▼         └──▶ idle    │
                         awaiting_approval             │
                            │        │                 │
                        approved   denied              │
                            │        │                 │
                            ▼        └──▶ streaming    │
                          tooling                      │
                            │                          │
                 tool_results_appended                 │
                            │                          │
                            └──▶ streaming ────────────┘

        idle ──manual_compact──▶ compacting ──compact_done──▶ idle
                                     │
                               compact_failed──▶ error ──user_ack──▶ idle

        streaming|awaiting_approval|tooling ──abort──▶ idle
                (persist aborted assistant if any visible output)

        idle ──handoff──▶ [TODO placeholder]
```

Note: `awaiting_approval` applies only to tools requiring confirmation (write_file, edit_file, bash). Tools with `allow` default (read_file, load_skill) skip directly to `tooling`.

### Invalid States & Degradation (V0 must define)

- **Orphan toolResult**: tool_result with no matching tool_call (common after mid-stream abort)
  - Strategy: **keep in storage** (messages table + EventLog), but **exclude from outbound provider payload**; log `validation_warning` event; UI shows "some tool results were excluded" banner; session remains fully usable
  - Real case: pi's transform-messages bug where errored/aborted assistant was skipped, leaving orphan toolResult

- **Aborted assistant persistence**: When user aborts during streaming:
  - If any visible output has streamed: persist `AssistantMessage` with `stopReason: "aborted"`, **exclude from future LLM context**, show grayed in UI
  - If abort before any delta: log abort event only, no assistant message persisted
  - Incomplete tool calls within aborted assistant are **dropped** (not persisted as ToolCallParts)

- **OpenAI-compatible content structure**: some backends mirror assistant.content block structure causing recursive bloat (pi #2007)
  - Strategy: assistant.content always sent as string (join text blocks), not content-part array — controlled by `compat.allowContentPartArray` flag (default: false)

## 6. Data Model

### TypeScript Types (V0 minimal set)

**ID generation**: All entity IDs (session, message, event) use `nanoid(21)` — URL-safe, compact, collision-resistant. Not time-sortable by default; use `ts` field for ordering. Rationale: simpler than ULID, sufficient for single-user local app.

```ts
// --- Primitives ---
export type Api = "openai-chat-completions" | "anthropic-messages";

export type StopReason = "stop" | "length" | "toolUse" | "error" | "aborted";

export type TextPart = { type: "text"; text: string };
export type ToolCallPart = {
  type: "toolCall"; id: string; name: string;
  arguments: Record<string, unknown>;
};
export type ThinkingPart = {
  type: "thinking"; thinking: string;
  thinkingSignature?: string; redacted?: boolean;
};

// --- Messages ---
export type UserMessage = {
  role: "user"; id: string;
  content: string;  // V0: text only (send string for max compat)
  ts: number; meta?: Record<string, unknown>;
};

export type AssistantMessage = {
  role: "assistant"; id: string;
  api: Api; providerId: string; modelId: string;
  content: Array<TextPart | ToolCallPart | ThinkingPart>;
  stopReason: StopReason;
  errorMessage?: string;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  ts: number; meta?: Record<string, unknown>;
};

export type ToolResultMessage = {
  role: "toolResult"; id: string;
  toolCallId: string; toolName: string;
  isError: boolean;
  content: TextPart[];    // Model-facing: what LLM sees
  details?: {             // UI-facing: structured metadata, NOT sent to LLM
    rawOutput?: string;   // Full untruncated output (if different from content)
    exitCode?: number;    // bash exit code
    truncated?: boolean;  // Whether content was truncated from rawOutput
    paths?: string[];     // Files affected
    diff?: string;        // edit_file diff preview
  };
  ts: number; meta?: Record<string, unknown>;
};

export type ScorelMessage = UserMessage | AssistantMessage | ToolResultMessage;

// --- Provider ---
export type ProviderCompat = {
  supportsDeveloperRole?: boolean;
  maxTokensField?: "max_completion_tokens" | "max_tokens";
  requiresToolResultName?: boolean;
  requiresAssistantAfterToolResult?: boolean;
  requiresThinkingAsText?: boolean;
};

export type ProviderConfig = {
  id: string; displayName: string;
  api: Api; baseUrl: string;
  auth: { type: "bearer" | "x-api-key"; keyRef: string; headerName?: string };
  defaultHeaders?: Record<string, string>;
  compat?: ProviderCompat;
  models: Array<{ id: string; displayName: string }>;
  meta?: Record<string, unknown>;
};

// --- Tools ---
export type ToolCall = {
  toolCallId: string;
  name: "bash" | "read_file" | "write_file" | "edit_file" | "load_skill";
  arguments: Record<string, unknown>;
};

export type ToolResult = {
  toolCallId: string;
  isError: boolean; content: string;
  details?: unknown;
};

// --- Events ---
export type ScorelEvent =
  | { type: "session.start"; sessionId: string; ts: number; meta?: Record<string, unknown> }
  | { type: "user.prompt"; sessionId: string; ts: number; message: UserMessage }
  | { type: "llm.request"; sessionId: string; ts: number; providerId: string; modelId: string; api: Api }
  | { type: "llm.stream"; sessionId: string; ts: number; event: AssistantMessageEvent }
  | { type: "llm.done"; sessionId: string; ts: number; message: AssistantMessage }
  | { type: "tool.exec.start"; sessionId: string; ts: number; toolCall: ToolCall }
  | { type: "tool.exec.update"; sessionId: string; ts: number; toolCallId: string; partial: string }
  | { type: "tool.exec.end"; sessionId: string; ts: number; result: ToolResult }
  | { type: "compact.manual"; sessionId: string; ts: number; summaryMessageId: string; transcriptPath?: string }
  | { type: "handoff.todo"; sessionId: string; ts: number; reason: string } // TODO
  | { type: "validation_warning"; sessionId: string; ts: number; detail: string }
  | { type: "runner_crash"; sessionId: string; ts: number; error: string }
  | { type: "compact.failed"; sessionId: string; ts: number; error: string }
  | { type: "approval.requested"; sessionId: string; ts: number; toolCall: ToolCall }
  | { type: "approval.resolved"; sessionId: string; ts: number; toolCallId: string; decision: "approved" | "denied" }
  | { type: "provider.retry"; sessionId: string; ts: number; attempt: number; error: string }
  | { type: "session.abort"; sessionId: string; ts: number };
```

```ts
// --- Normalized Provider Event Stream ---
export type AssistantMessageEvent =
  | { type: "start"; partial: AssistantMessage }
  | { type: "text_delta"; contentIndex: number; delta: string; partial: AssistantMessage }
  | { type: "text_end"; contentIndex: number; content: string; partial: AssistantMessage }
  | { type: "thinking_delta"; contentIndex: number; delta: string; partial: AssistantMessage }
  | { type: "thinking_end"; contentIndex: number; content: string; partial: AssistantMessage }
  | { type: "toolcall_delta"; contentIndex: number; delta: string; partial: AssistantMessage }
  | { type: "toolcall_end"; contentIndex: number; toolCall: ToolCallPart; partial: AssistantMessage }
  | { type: "done"; reason: StopReason; message: AssistantMessage }
  | { type: "error"; reason: "aborted" | "error"; error: AssistantMessage };
```

## 7. Storage

### SQLite Schema (V0)

```sql
PRAGMA journal_mode=WAL;

CREATE TABLE IF NOT EXISTS providers (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  api TEXT NOT NULL DEFAULT 'openai-chat-completions',
  base_url TEXT NOT NULL,
  auth_json TEXT NOT NULL,        -- { type, keyRef, headerName? }
  default_headers_json TEXT,
  compat_json TEXT,               -- ProviderCompat
  models_json TEXT NOT NULL,      -- Array<{ id, displayName }>
  meta_json TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  title TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  archived INTEGER NOT NULL DEFAULT 0,
  workspace_root TEXT NOT NULL,
  active_provider_id TEXT,
  active_model_id TEXT,
  active_compact_id TEXT,
  pinned_system_prompt TEXT,
  settings_json TEXT
);

CREATE TABLE IF NOT EXISTS compactions (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  boundary_message_id TEXT NOT NULL,
  summary_text TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  transcript_path TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_compactions_session ON compactions(session_id, created_at);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  ts INTEGER NOT NULL,
  type TEXT NOT NULL,
  payload_json TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_events_session_seq ON events(session_id, seq);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL,
  seq INTEGER NOT NULL,
  ts INTEGER NOT NULL,
  message_json TEXT NOT NULL,
  searchable_text TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_session_seq ON messages(session_id, seq);
CREATE INDEX IF NOT EXISTS idx_messages_session_ts ON messages(session_id, ts);

CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
  session_id UNINDEXED,
  message_id UNINDEXED,
  content
);

-- TODO V1: embeddings table reserved
CREATE TABLE IF NOT EXISTS embeddings (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  model TEXT NOT NULL,
  vector BLOB NOT NULL,
  hash TEXT NOT NULL,
  tombstone INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
```

### EventLog JSONL Format

- Each line: `{"v":"scorel.eventlog.v0","seq":123,"event":{...}}`
- `seq` must be monotonically increasing; Core uses same seq for SQLite events table and JSONL file (reconcilable)
- Manual compact writes "transcript JSONL" alongside summary for recovery

### Migration Strategy

- `PRAGMA user_version` + idempotent migration scripts
- Session deletion: soft delete (mark) → hard delete (user confirms)
- Large tool output: micro_compact replaces in active context, but original preserved in message_json / transcript

### FTS5 Sync Strategy

- FTS entries are written **synchronously** on message insert (same transaction as messages table write)
- Indexed content: user message text, assistant text parts (joined), tool result content (truncated to first 2000 chars)
- On manual compact: the summary message gets a new FTS entry; old entries are NOT deleted (search can still find historical content)
- FTS rebuild: `INSERT INTO messages_fts(messages_fts) VALUES('rebuild')` — available as admin/debug command, not exposed in normal UI

### Export Formats

**JSONL export** (`session.export.jsonl`):
```
{"v":"scorel.export.v0","session":{...sessionMeta}}
{"v":"scorel.export.v0","message":{...ScorelMessage}}
{"v":"scorel.export.v0","message":{...ScorelMessage}}
...
```
One session metadata line, then one line per message in chronological order. Messages include full `message_json` (not micro_compacted).

**Markdown export** (`session.export.md`):
```markdown
# Session: {title}
Provider: {providerId} / Model: {modelId}
Created: {created_at} | Exported: {now}

---

**User** (2024-01-01 12:00:00)
{user message text}

**Assistant** (2024-01-01 12:00:05)
{assistant text}

> Tool: bash
> Command: `npm test`
> Result: (truncated to 500 chars)
> {tool result preview}

**Assistant** (2024-01-01 12:00:15)
{final assistant text}
```
Tool calls and results are rendered as blockquotes with truncated output. Full output available in JSONL export.

## 8. Runner IPC Protocol

### Transport: stdio JSONL

Core spawns Runner as child process. Core writes commands to stdin, Runner writes events to stdout. Each line is one JSON object.

**Why stdio JSONL**: recordable/replayable (natural golden tests), cross-language extensible, low complexity, aligned with MCP stdio transport.

### Parallel Tool Calls (V0 decision: sequential)

OpenAI may return multiple `tool_calls` in a single response. V0 executes them **sequentially** (one at a time, in order). Rationale:
- Simpler Runner protocol and state management
- Avoids concurrent filesystem access conflicts (two `write_file` calls to the same file)
- Permission approval UX is clearer (one confirmation at a time)
- Parallel execution is a V1+ optimization (reserve `executionMode: "sequential" | "parallel"` in ToolCall type)

All tool_results are collected and sent back in a single follow-up request (matching the order of tool_calls).

### Tool Output Truncation

Tool output is truncated at the **Runner level** before it enters the message pipeline:

| Tool | Max Output | Truncation Strategy |
|------|-----------|-------------------|
| bash | 32,000 chars | Keep first 8,000 + last 8,000 chars; insert `\n...[truncated {n} chars]...\n` in middle |
| read_file | 64,000 chars | Truncate at limit with `\n...[truncated, showing first {n} lines]` |
| write_file | 500 chars | Only return status message (success/error + path) |
| edit_file | 2,000 chars | Return diff summary or error; not full file content |

These limits are configurable via `runner.config.json` but defaults should be safe for most models' context windows.

### Tool Parameter Schemas (sent to OpenAI as `tools[]`)

```ts
const SCOREL_TOOLS = [
  {
    type: "function",
    function: {
      name: "bash",
      description: "Execute a shell command in the workspace directory. Use for running tests, installing packages, git operations, etc.",
      parameters: {
        type: "object",
        required: ["command"],
        properties: {
          command: { type: "string", description: "The shell command to execute" },
          timeout_ms: { type: "integer", description: "Timeout in milliseconds (default: 30000, max: 300000)" }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read the contents of a file. Returns the file content with line numbers.",
      parameters: {
        type: "object",
        required: ["path"],
        properties: {
          path: { type: "string", description: "File path relative to workspace root" },
          start_line: { type: "integer", description: "Start reading from this line (1-based, inclusive)" },
          end_line: { type: "integer", description: "Stop reading at this line (1-based, inclusive)" }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description: "Create or overwrite a file with the given content.",
      parameters: {
        type: "object",
        required: ["path", "content"],
        properties: {
          path: { type: "string", description: "File path relative to workspace root" },
          content: { type: "string", description: "The full file content to write" }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "edit_file",
      description: "Apply a targeted edit to an existing file by replacing an exact string match.",
      parameters: {
        type: "object",
        required: ["path", "old_string", "new_string"],
        properties: {
          path: { type: "string", description: "File path relative to workspace root" },
          old_string: { type: "string", description: "The exact string to find and replace (must be unique in the file)" },
          new_string: { type: "string", description: "The replacement string" }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "load_skill",
      description: "Load a skill's full instructions by name. Use when you need detailed guidance for a specific task.",
      parameters: {
        type: "object",
        required: ["name"],
        properties: {
          name: { type: "string", description: "Skill name from the available skills list" }
        }
      }
    }
  }
];
```

### Commands (Core → Runner via stdin)

```ts
type RunnerCommand =
  | { type: "tool.exec"; requestId: string; toolCallId: string; tool: string; args: Record<string, unknown> }
  | { type: "abort"; toolCallId: string }
  | { type: "ping" };
```

### Events (Runner → Core via stdout)

```ts
type RunnerEvent =
  | { type: "tool_execution_start"; toolCallId: string }
  | { type: "tool_execution_update"; toolCallId: string; partial: string }
  | { type: "tool_execution_end"; toolCallId: string; result: ToolResult }
  | { type: "heartbeat" };
```

### Lifecycle Rules

- **Ack**: after Core sends `tool.exec`, Runner must respond with `tool_execution_start` before Core marks it running
- **Timeout**: **Core is the authoritative timeout owner**. On timeout: Core sends `abort` command → waits 5s grace period → if no `tool_execution_end` received → kills Runner process + restarts → synthesizes error ToolResultMessage. Runner does NOT independently timeout; it only responds to Core's abort.
- **Crash recovery**: Core logs `runner_crash` event; in-flight tool calls become error ToolResultMessage (so LLM can continue)
- **Heartbeat**: Runner sends heartbeat every 2s

### MockRunner & Golden Tests (V0 mandatory)

- **MockRunner**: same protocol, returns preset `tool_execution_*` event sequences (no real execution)
- **ReplayRunner**: reads recorded JSONL and replays (for regression)
- **Pass criteria**: same recorded script replayed in CI produces consistent message projection (ignoring timestamps)

## 9. Compact Strategy

### micro_compact (per-turn, automatic)

- After each turn, replace tool_result content older than `KEEP_RECENT` turns with `"[Previous: used {tool_name}]"`
- `KEEP_RECENT` default: **3 turns** (configurable in session settings; a "turn" = one user prompt + assistant response + any tool calls in between)
- Original content preserved in `message_json` and EventLog (never lost)
- Runs silently, no user interaction

### manual compact (user-triggered)

- User triggers via command or UI button
- Process: serialize conversation → truncate tool results → generate summary via LLM → save transcript JSONL for recovery
- Summary replaces old messages in active context; transcript preserves full history
- Core principle: "history is never lost, only moved out of active context"

**Storage model (non-destructive)**:
- Manual compact does NOT delete or overwrite messages in the `messages` table
- It creates a `compaction` record with the summary text and a `boundary_message_id` (the last message included in the summary)
- Active context after compact = Layer 1 instructions + compact summary + messages after boundary
- Multiple compacts accumulate: only the latest compact's summary is used in active context (older compacts are superseded but preserved)
- The `sessions.active_compact_id` field points to the current active compaction

**LLM call for summary generation**:
- Uses the **same provider and model** as the current session (no separate summarization model in V0)
- If provider is unavailable: compact fails gracefully, session continues with uncompacted context, UI shows error
- Summary prompt template (hardcoded in V0, configurable in V1+):
  ```
  Summarize the following conversation, preserving:
  1. Key decisions and their rationale
  2. Files that were created or modified (with paths)
  3. Current task status and next steps
  4. Any unresolved issues or errors

  Be concise but complete. This summary will replace the conversation history.

  <conversation>
  {serialized_messages}
  </conversation>
  ```
- Serialization: messages are converted to plain text (role + content), tool results truncated to first 500 chars each
- Max serialized input: 100,000 chars (excess is truncated from the oldest messages, keeping the most recent)

## 10. Skills (Two-Layer Injection)

### Skill Manifest

Each skill is a `SKILL.md` file with YAML frontmatter:

```yaml
---
name: code-review
description: Reviews code for bugs, security issues, and best practices
version: 1.0.0
---
# Code Review Skill
[Full skill instructions here...]
```

### Loading Strategy

- **Session start**: scan skill directories, load only metadata (name/description/version) into system prompt
- **On demand**: when model calls `load_skill(name)`, read full SKILL.md and inject as tool_result
- **After use**: optionally remove skill content from working context, keep only result summary (aligns with compact strategy)

### `load_skill` Tool Definition

```ts
{
  name: "load_skill",
  description: "Load a skill's full instructions by name. Use when you need detailed guidance for a specific task.",
  parameters: {
    type: "object",
    required: ["name"],
    properties: { name: { type: "string", description: "Skill name from the available skills list" } }
  }
}
```

## 11. Permission & Security

### Tool Permission Model (V0 simplified)

| Tool | Default | Scope |
|------|---------|-------|
| read_file | Allow | workspace root + configured paths |
| write_file | Confirm each time | workspace root only |
| edit_file | Confirm each time | workspace root only |
| bash | Confirm each time | workspace root as cwd |
| load_skill | Allow | registered skill directories |

### Command Safety

- Command blacklist: `rm -rf /`, `curl | sh`, etc. (configurable)
- Workspace path whitelist: prohibit writes outside boundary
- Denial handling: rejected tool call → feed error tool_result back to LLM (model can continue)

### Key Management

- Keys stored in macOS Keychain; DB stores only `keyRef`
- Renderer never reads plaintext keys
- Log redaction: mask Authorization headers, suspected tokens, home/user paths by default
- Export provides two modes: "include original" / "redacted" (user confirms)

## 12. Sequence Diagram (One Complete Round with Tools)

```
User(UI)          Core              Runner           Provider(OpenAI)
  │                 │                  │                    │
  │──send(prompt)──▶│                  │                    │
  │                 │──persist msg────▶│                    │
  │                 │──POST /chat/completions (stream)─────▶│
  │                 │◀─────────────────SSE deltas───────────│
  │◀──render stream─│                  │                    │
  │                 │  [finish_reason == tool_calls]        │
  │                 │──tool.exec──────▶│                    │
  │                 │◀──start/update/end│                   │
  │                 │──append ToolResultMessage             │
  │                 │──POST /chat/completions (with results)▶│
  │                 │◀─────────────────SSE final text───────│
  │◀──render final──│                  │                    │
```

## 13. Session Resume (After Restart)

When the app restarts and user opens an existing session:

1. Load session metadata from `sessions` table (including `active_compact_id`)
2. If `active_compact_id` is set, load the compaction record from `compactions` table
3. Load messages from `messages` table:
   - If compaction exists: load only messages with `seq > boundary_message.seq`
   - Otherwise: load all messages (ordered by `seq`)
4. Apply micro_compact to the loaded messages (replace old tool_results with placeholders)
5. The resulting context = Layer 1 instructions + compact summary (if any) + working set messages
6. If the last message was an aborted assistant (`stopReason: "aborted"`), exclude it from LLM context (user sees it grayed out in UI)
7. If there are orphan toolResults (detected during validation), exclude from outbound payload, show warning banner

**NOT from EventLog**: V0 resumes from the `messages` + `compactions` tables, not by replaying EventLog. EventLog is for export/debug/golden tests only.

**In-flight state**: If the app crashed during streaming or tooling, incomplete messages were never persisted (messages are written on `llm.done` or `tool.exec.end`). The session resumes cleanly from the last complete message. Pending approvals are lost; session returns to `idle`.

**Crash vs abort**: User abort may produce a persisted aborted assistant (if visible output existed). App crash never does — only committed messages survive.

## 14. Error Handling & Retry

### Provider Errors

| Error | Strategy | Max Retries |
|-------|----------|:-----------:|
| 429 (rate limit) | Respect `Retry-After` header; exponential backoff with jitter (base: 1s, max: 60s) | 3 |
| 500/502/503 (server error) | Exponential backoff with jitter (base: 2s, max: 30s) | 2 |
| Network error (ECONNREFUSED, timeout) | Retry after 3s | 2 |
| 400 (bad request) | Do NOT retry; log error; surface to user with request details for debugging | 0 |
| 401/403 (auth) | Do NOT retry; prompt user to check API key | 0 |

**Anthropic-specific errors**:
- 400 with `invalid_request_error`: usually message ordering/system extraction issue — do NOT retry; log full request for debugging
- 529 (API overloaded): treat like 503, exponential backoff, max 2 retries

### Retry Behavior

- Retries are transparent to the user (no UI flicker); show spinner with "retrying..." indicator after first failure
- After max retries exhausted: transition to `error` state; UI shows error message with "Retry" button
- Retry reuses the exact same request payload (idempotent for chat completions)
- Abort during retry: cancel immediately, no further retries

### Tool Execution Errors

- Tool throws/crashes: Runner catches and returns `ToolResult` with `isError: true` and error message
- Tool timeout: Runner sends `tool_execution_end` with `isError: true` and "execution timed out" message
- Runner process crash: Core detects via process exit event, logs `runner_crash`, converts in-flight tool calls to error ToolResultMessages, restarts Runner
- All error tool_results are fed back to LLM so it can adapt (e.g., retry with different command, explain the error to user)

## 15. Test Matrix

| Level | Coverage | Pass Criteria |
|-------|----------|---------------|
| Unit | Normalization, compat fixes (assistant.content=string), orphan toolResult validation, micro_compact | All critical edge cases green; each failure has clear event + UI error state |
| Integration | Core↔Runner protocol, Core↔OpenAI (mock) | Event sequences valid (start→update→end); abort reproducible |
| E2E | UI→Core→Provider→Runner full round | Complete at least 1 tool round; session recoverable after restart; FTS finds recent messages |
| Golden | Recorded JSONL replay | Version upgrade doesn't change projection (unless schema bump) |
| Performance | Long session + large tool output | micro_compact effective; manual compact produces transcript and is recoverable |

### Critical Test Cases (V0 must be in CI)

- **Case A**: Streaming output + stop + send again (no tools)
- **Case B**: Tool round: tool_calls → execute → re-request → final text
- **Case C**: Reproduce pi #2007 pattern: if assistant.content is not string, some backends recursively nest; verify V0 forces string
- **Case D**: Abort mid-stream does not produce orphan toolResult; verify "detect orphan → prohibit sending"
- **Case E**: Anthropic text-only streaming turn completes successfully
- **Case F**: Anthropic tool round: tool_use → execute → re-request with tool_result in user message → final text
- **Case G**: `transformMessages()` correctly extracts system prompt, regroups tool_results into user messages, enforces ordering rules for Anthropic
- **Case H**: Tool call ID normalization: IDs > 64 chars are deterministically shortened for Anthropic, original preserved in storage
- **Case I**: Manual compact boundary: compact → new messages → resume → only post-boundary messages + summary in context
- **Case J**: Approval flow: deny tool call → error ToolResultMessage fed back → model adapts

## 16. Milestones

### V0 Milestones (M1–M5)

| Milestone | Content | Person-Days | Go/No-Go |
|-----------|---------|:-----------:|----------|
| M1 Core | Canonical message model + EventStream + OpenAI adapter + message persistence | 12–18 | Case A/B pass (OpenAI) |
| M1.5 Anthropic | Anthropic adapter + transformMessages() + tool_call_id normalization | 8–12 | Case E/F/G/H pass |
| M2 Tools | Runner (stdio JSONL) + bash/read/write/edit + approval state machine + Core-owned timeout | 15–22 | Tool round stable, abort/crash recovery works, Case J pass |
| M3 History | SQLite + FTS5 + compactions table + export JSONL/MD | 10–16 | Search performance meets criteria, export usable |
| M4 Compact/Skills | Three-layer compact (micro + manual + boundary resume) + load_skill (two-layer) | 12–18 | Case I pass, long session doesn't blow up |
| M5 Release | codesign + notarize + updater (optional) | 8–12 | Install/upgrade loop works |

### Task Granularity Examples

- **Core**: implement tool calling loop (depends on OpenAI API) → acceptance: Case B
- **Runner**: stdio JSONL protocol + MockRunner → acceptance: golden replay consistent
- **Storage**: messages/events/fts schema + WAL setup → acceptance: 10k message search < 200ms
- **Compact**: micro_compact (3-turn window) + manual compact (serialize + truncate + summarize + transcript) → acceptance: long session can continue
- **Skills**: scan SKILL.md frontmatter + `load_skill` tool_result injection → acceptance: model can list skills and load on demand

### Key Risks (V0 Go/No-Go)

- **OpenAI-compatible compat bugs** (assistant.content structure) causing sessions to degrade: must lock down with regression tests
- **Tool execution + approval UX unclear** causing users to distrust: "confirm each time + copyable command + viewable diff" must be in place
- **Compact summary quality fluctuation**: V0 goal is NOT "perfect summary" but "recoverable + no history loss + can continue"

## 17. Post-V0 Roadmap

| Phase | Key Features | Dependencies |
|-------|-------------|-------------|
| V1 M1 | auto_compact (threshold-triggered), subagent tool (context isolation), TodoWrite planning tool | V0 stable, compact proven |
| V1 M2 | MCP integration (stdio + Streamable HTTP), tool discovery | Runner protocol extensible |
| V1 M3 | Embedding pipeline, vector search (hybrid FTS + ANN) | Storage layer stable |
| V2 | Handoff (new thread from old context), multi-provider routing | Compact + session model mature |
| V3 | Plugin/skill marketplace, team collaboration, cloud sync | Security model hardened |

## 18. Design Decisions Record

| Decision | Context | Choice | Consequence |
|----------|---------|--------|-------------|
| Message model aligns with pi-ai | Need proven abstractions for multi-provider support | Adopt `Message/Context/StopReason/AssistantMessageEvent` | Lower migration cost when adding Anthropic; event protocol already battle-tested |
| assistant.content as string | pi #2007: some backends mirror content-part array causing recursive nesting | Force string, reserve compat flag for array | Slightly less expressive but eliminates a class of bugs |
| stdio JSONL for Runner | Need recordable/replayable tool execution | stdio over fork IPC | Natural golden tests; cross-language extensible; aligned with MCP stdio |
| SQLite + EventLog dual-write | Need both queryable projection and exportable canonical log | Write to both with same seq | Reconcilable; EventLog is the source of truth for replay |
| Two-layer skill injection | Full skill content is expensive in context | Metadata in system prompt, full content on-demand via tool_result | Balances discoverability with token efficiency |
| micro_compact before manual | Long sessions bloat from tool output | Auto-replace old tool_result with placeholder | Transparent to user; original preserved in storage |
| Anthropic Messages in V0 | Need proven multi-provider support from day one | Dual adapter with canonical model + transformMessages() | Two adapters to maintain; but validates the abstraction early |
| Normalized EventStream | Both providers stream differently | Canonical AssistantMessageEvent consumed by UI and persistence | Adapter complexity contained; UI code is provider-agnostic |
| Tool result content/details separation | LLM doesn't need full raw output; UI needs structured metadata | content = model-facing summary, details = UI-facing structured payload | Cleaner context, better tool UX, aligns with pi-ai pattern |
| Core-owned tool timeout | Runner vs Core timeout ambiguity | Core is authoritative; Runner only responds to abort | Single source of truth for timeout behavior |
| Non-destructive manual compact | Need to support resume/search/export after compact | Compaction record + boundary; messages table never mutated | Simple resume, search still works, export gets full history |
| Write-only secret submission | Renderer must collect key but should not have read access | storeSecret/hasSecret/clearSecret API; no getSecret | Pragmatic Electron security without false invariants |
| Deterministic message ordering | Same-ms writes can reorder assistant/tool_result pairs | messages.seq column (monotonic per session) | Reliable resume and replay |
