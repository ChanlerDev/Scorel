# V0-M2: Tool Execution

> Runner (stdio JSONL) + bash/read/write/edit + approval state machine + Core-owned timeout

## Goal

Complete the tool execution loop: model requests tool calls → user approves → Runner executes → results fed back → model continues.

## Scope

- **Runner process**: standalone child process communicating via stdio JSONL
- **4 built-in tools**: bash, read_file, write_file, edit_file
- **Tool dispatch map**: `toolName → handler + approval policy + schema`
- **Approval state machine**: `awaiting_approval` session state with approve/deny IPC
- **Core-owned timeout**: Core sends abort after timeout, waits grace period, kills/restarts if needed
- **Sequential execution**: multiple tool_calls executed one at a time, in order
- **Abort during tooling**: persist aborted assistant, synthesize error for in-flight tool calls
- **Runner crash recovery**: detect exit, log `runner_crash`, restart, synthesize error results
- **Tool output truncation**: at Runner level before entering message pipeline

## Out of Scope (M2)

- Parallel tool execution (→ V1+)
- load_skill tool (→ M4)
- Workspace path canonicalization / symlink resolution (document as known limitation)

## Key Implementation Notes

### Runner Protocol

**Commands** (Core → Runner stdin):
```ts
type RunnerCommand =
  | { type: "tool.exec"; requestId: string; toolCallId: string; tool: string; args: Record<string, unknown> }
  | { type: "abort"; toolCallId: string }
  | { type: "ping" };
```

**Events** (Runner → Core stdout):
```ts
type RunnerEvent =
  | { type: "tool_execution_start"; toolCallId: string }
  | { type: "tool_execution_update"; toolCallId: string; partial: string }
  | { type: "tool_execution_end"; toolCallId: string; result: ToolResult }
  | { type: "heartbeat" };
```

### Tool Dispatch Map

```ts
type ToolEntry = {
  name: string;
  schema: object;           // JSON Schema for parameters
  approval: "allow" | "confirm";
  handler: (args) => ToolResult;
};

const TOOL_REGISTRY: Map<string, ToolEntry> = new Map([
  ["bash",       { approval: "confirm", ... }],
  ["read_file",  { approval: "allow", ... }],
  ["write_file", { approval: "confirm", ... }],
  ["edit_file",  { approval: "confirm", ... }],
]);
```

### Approval Flow (per tool call)

1. Model returns `finish_reason: toolUse` with N tool calls
2. For each tool call (sequential):
   a. Check `TOOL_REGISTRY[name].approval`
   b. If `"allow"` → skip approval, execute immediately
   c. If `"confirm"` → emit `approval.requested` event → session enters `awaiting_approval`
   d. User approves → execute → emit `approval.resolved`
   e. User denies → synthesize error `ToolResultMessage` → emit `approval.resolved`
   f. User closes approval dialog without action → treated as deny
3. After all tool calls resolved, collect results and resume model loop

### Multiple Tool Calls with Partial Deny

When model returns 3 tool calls and user denies #2:
- Tool #1: already executed (result committed)
- Tool #2: denied → error `ToolResultMessage` with `"Tool call denied by user"`
- Tool #3: still presented for approval (not auto-cancelled)
- All results (success + error) sent back in one follow-up request

### Core-Owned Timeout

- Default timeout: 30s for bash (configurable via `timeout_ms` param, max 300s), 10s for file tools
- On timeout: Core sends `abort` → waits 5s grace → if no `tool_execution_end` → kill Runner + restart → synthesize error `ToolResultMessage`
- Runner does NOT independently timeout; it only responds to abort

### Tool Output Truncation

| Tool | Max Output | Strategy |
|------|-----------|----------|
| bash | 32,000 chars | Keep first 8,000 + last 8,000; `...[truncated N chars]...` in middle |
| read_file | 64,000 chars | Truncate with `...[truncated, showing first N lines]` |
| write_file | 500 chars | Status message only (success/error + path) |
| edit_file | 2,000 chars | Diff summary or error |

### Tool Result Structure

```ts
type ToolResult = {
  toolCallId: string;
  isError: boolean;
  content: string;         // Model-facing: truncated, summarized
  details?: {              // UI-facing: structured metadata
    rawOutput?: string;    // Full output (if different from content)
    exitCode?: number;     // bash only
    truncated?: boolean;
    paths?: string[];
    diff?: string;         // edit_file diff
  };
};
```

### Tool Error Semantics

| Error Case | Behavior |
|-----------|----------|
| `edit_file` 0 matches | `isError: true`, content: "No match found for old_string" |
| `edit_file` multiple matches | `isError: true`, content: "Multiple matches found (N); old_string must be unique" |
| `read_file` file not found | `isError: true`, content: "File not found: {path}" |
| `read_file` binary file | `isError: true`, content: "Binary file detected, cannot read as text: {path}" |
| `write_file` parent dir missing | Create parent directories automatically (mkdir -p equivalent) |
| `bash` non-zero exit | `isError: false` (non-zero exit is informational, not an error); `details.exitCode` set |
| `bash` interactive command | No special detection in V0; rely on timeout |
| Any tool path escape | `isError: true`, content: "Path escapes workspace root: {path}" |

## Acceptance Criteria

- [ ] **Case B**: Complete tool round: tool_calls → approve → execute → re-request → final text (both OpenAI + Anthropic)
- [ ] **Case D**: Abort mid-tool-execution → error ToolResultMessage → no orphan in next request
- [ ] **Case J**: Deny tool call → error ToolResultMessage fed back → model adapts
- [ ] Runner crash → Core detects, restarts, in-flight tool → error result, session continues
- [ ] Timeout → abort → grace → kill → error result
- [ ] MockRunner: golden replay produces consistent results
- [ ] Tool output truncation effective (32k bash output → truncated in content, full in details)

## Files to Create/Modify

| File | Action |
|------|--------|
| `runner/index.ts` | Create: stdio JSONL process, command dispatch |
| `runner/tools/bash.ts` | Create: shell execution with timeout, exit code |
| `runner/tools/read-file.ts` | Create: file read with line range, binary detection |
| `runner/tools/write-file.ts` | Create: file write with mkdir -p, path validation |
| `runner/tools/edit-file.ts` | Create: exact-match replace with uniqueness check |
| `src/main/runner/runner-manager.ts` | Create: spawn, lifecycle, crash recovery |
| `src/main/runner/mock-runner.ts` | Create: preset responses for testing |
| `src/main/core/tool-dispatch.ts` | Create: tool registry, approval routing |
| `src/main/core/orchestrator.ts` | Modify: add tool loop + approval state |
| `src/preload/index.ts` | Modify: add tools.approve/deny |

## Definition of Done

Full tool round works end-to-end for both providers. Approval UX functional. Abort/crash/timeout all produce clean error results. MockRunner golden tests pass.
