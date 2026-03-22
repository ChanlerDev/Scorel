# V1-M1: Autonomy Foundation

> auto_compact + subagent + TodoWrite + permission system

## Goal

Give Scorel the baseline autonomy required for longer and more complex tasks without depending on constant manual steering. After M1, a session can auto-manage its own context window, delegate subtasks, track progress, and enforce user-defined permission policies.

## Scope

### A1: auto_compact

**Problem**: V0 manual compact requires the user to notice context growth and trigger it themselves. Long sessions risk hitting the provider context limit mid-turn.

**Solution**: Token-threshold-triggered automatic compaction that fires transparently between turns.

- **Threshold config**: `auto_compact.threshold` (default 80% of provider model context window) stored in session settings
- **Trigger point**: after each `llm.done`, before next user send — check accumulated token usage against threshold
- **Compaction strategy**: reuse V0 manual compact pipeline (serialize → summarize → boundary record → resume)
- **Notification**: emit `compact.auto` event; UI shows non-blocking indicator ("Context compacted")
- **User override**: users can disable auto_compact per session or globally
- **Cascading**: if a single auto_compact still leaves usage above threshold (extremely long tool results), run micro_compact first, then auto_compact

### A2: subagent Tool

**Problem**: Some tasks benefit from isolated exploration (search a codebase, test an approach) without polluting the parent context.

**Solution**: A `subagent` tool that spawns an isolated child conversation, executes it to completion, and returns a summary to the parent.

- **Isolation**: child gets a fresh `messages[]` with its own system prompt + task description injected as the first user message
- **Tool access**: child inherits the parent's tool registry and permission policy
- **Return path**: on child completion, the final assistant message is summarized (via LLM call or truncation) and returned as `ToolResult.content` to the parent
- **Limits**: max depth = 1 (no nested subagents in V1); max child turns configurable (default 20); max child token budget configurable
- **Abort**: parent abort propagates to child; child timeout → error result to parent
- **Persistence**: child messages stored in their own session (linked via `sessions.parent_session_id`); parent receives summary only

### A3: TodoWrite Tool

**Problem**: Multi-step tasks lack structured progress tracking. The model's plan lives only in prose, making it hard to verify completion.

**Solution**: A `todo_write` tool for creating and updating structured task lists persisted to the session.

- **Operations**: `create`, `update`, `delete`, `list`
- **Task model**: `{ id, title, status: "pending" | "in_progress" | "done", notes? }`
- **Storage**: `todos` table in SQLite, scoped to session
- **LLM visibility**: current todo list injected into system prompt (after instruction layer, before conversation history)
- **Approval**: `approval: "allow"` (no user confirmation needed — it's a planning artifact, not a file mutation)
- **Compact interaction**: todo list survives compact (injected from DB, not from message history)

### A4: Permission System

**Problem**: V0 has only binary approval per tool (`"allow"` or `"confirm"`). Users cannot grant blanket trust or deny specific tools entirely.

**Solution**: A layered permission system with global override and per-tool granularity.

- **Permission levels**: `"allow"` (auto-approve) | `"confirm"` (ask each time) | `"deny"` (reject automatically)
- **full_access mode**: global toggle that overrides all tools to `"allow"` (except subagent, which stays `"confirm"`)
- **Reject with reason**: when a tool call is denied (manually or by policy), the error `ToolResult` includes a configurable reason string so the model can adapt
- **Config storage**: `permission_config` JSON column in `sessions` table (session-level) + `settings.permissions` in global settings (app-level); session inherits global, can override
- **UI**: Settings panel (from M6) extended with permission editor; per-session override via chat command or sidebar
- **MCP tools**: permission system must accommodate tools with unknown names (from V1-M2); default policy for unregistered tools = `"confirm"`

## Out of Scope (V1-M1)

- Nested subagents (depth > 1) (→ V2+)
- Parallel tool execution (→ V1+ optimization, orthogonal to this milestone)
- auto_compact with handoff (→ V2)
- Configurable compact summary prompt template (→ V1+ polish)
- Path-scoped permissions (allow write only in `src/`) (→ V2)

## Key Implementation Notes

### auto_compact Trigger

```ts
// In orchestrator, after llm.done:
async function maybeAutoCompact(session: Session): Promise<void> {
  if (!session.settings.autoCompact.enabled) return;

  const usage = session.lastTokenUsage;
  const limit = getModelContextLimit(session.providerId, session.model);
  const threshold = session.settings.autoCompact.threshold ?? 0.8;

  if (usage.totalTokens / limit >= threshold) {
    await runMicroCompact(session);  // free tool results first
    await runManualCompact(session); // then summarize
    emitEvent({ type: "compact.auto", sessionId: session.id, ts: Date.now() });
  }
}
```

### subagent Tool Schema

```ts
const subagentTool: ToolEntry = {
  name: "subagent",
  schema: {
    type: "object",
    properties: {
      task: { type: "string", description: "Task description for the child agent" },
      max_turns: { type: "number", description: "Max conversation turns (default 20)" },
    },
    required: ["task"],
  },
  approval: "confirm",
  handler: async (args) => {
    const childSession = await createChildSession({
      parentSessionId: currentSession.id,
      workspace: currentSession.workspace,
      task: args.task,
      maxTurns: args.max_turns ?? 20,
      permissionConfig: currentSession.permissionConfig,
    });
    const result = await runChildToCompletion(childSession);
    return {
      toolCallId,
      isError: false,
      content: result.summary,         // LLM-summarized or truncated final output
      details: {
        childSessionId: childSession.id,
        turnsUsed: result.turnsUsed,
        status: result.status,         // "completed" | "max_turns" | "aborted" | "error"
      },
    };
  },
};
```

### TodoWrite Tool Schema

```ts
const todoWriteTool: ToolEntry = {
  name: "todo_write",
  schema: {
    type: "object",
    properties: {
      operation: { type: "string", enum: ["create", "update", "delete", "list"] },
      id: { type: "string", description: "Task ID (required for update/delete)" },
      title: { type: "string", description: "Task title (required for create)" },
      status: { type: "string", enum: ["pending", "in_progress", "done"] },
      notes: { type: "string", description: "Optional notes or details" },
    },
    required: ["operation"],
  },
  approval: "allow",
  handler: async (args) => { /* CRUD against todos table */ },
};
```

### Permission Resolution

```ts
type PermissionLevel = "allow" | "confirm" | "deny";

type PermissionConfig = {
  fullAccess: boolean;                              // global override
  toolDefaults: Record<string, PermissionLevel>;    // per-tool policy
  denyReasons: Record<string, string>;              // custom deny reason per tool
};

function resolvePermission(
  toolName: string,
  sessionConfig: PermissionConfig,
  globalConfig: PermissionConfig,
): { level: PermissionLevel; reason?: string } {
  // 1. full_access overrides everything (except subagent)
  if (sessionConfig.fullAccess && toolName !== "subagent") {
    return { level: "allow" };
  }

  // 2. Session-level override
  if (toolName in sessionConfig.toolDefaults) {
    const level = sessionConfig.toolDefaults[toolName];
    return { level, reason: sessionConfig.denyReasons[toolName] };
  }

  // 3. Global default
  if (toolName in globalConfig.toolDefaults) {
    const level = globalConfig.toolDefaults[toolName];
    return { level, reason: globalConfig.denyReasons[toolName] };
  }

  // 4. Hardcoded fallback (built-in tools use TOOL_REGISTRY default; unknown tools = confirm)
  return { level: "confirm" };
}
```

### Session State Machine (V1 additions)

```
idle ──send_prompt──▶ streaming ──toolUse──▶ awaiting_approval ──approve──▶ tooling ──done──▶ idle
                         │                         │                          │
                     abort ──▶ idle            deny ──▶ tooling          abort ──▶ idle
                                                                            │
                                                                    [subagent running]
                                                                            │
                                                                      child_done ──▶ idle

idle ──auto_compact──▶ compacting ──done──▶ idle
```

### Todos Table Schema

```sql
CREATE TABLE IF NOT EXISTS todos (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  notes TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_todos_session ON todos(session_id);
```

### Sessions Table Extension

```sql
ALTER TABLE sessions ADD COLUMN parent_session_id TEXT REFERENCES sessions(id);
ALTER TABLE sessions ADD COLUMN permission_config TEXT; -- JSON PermissionConfig
```

## Acceptance Criteria

- [ ] auto_compact fires transparently when token usage crosses threshold; session continues cleanly
- [ ] auto_compact disabled per session → no auto-trigger even at 100% usage
- [ ] subagent: parent requests `subagent({ task: "list all .ts files" })` → child executes → summary returned to parent context
- [ ] subagent depth > 1 rejected with error ToolResult
- [ ] subagent abort: parent aborted → child aborted → error result
- [ ] subagent max_turns: child hits limit → returns partial summary with `status: "max_turns"`
- [ ] todo_write: create → update status → list shows current state → survives compact
- [ ] todo list injected into system prompt and visible to LLM after compact
- [ ] Permission `"deny"`: tool call auto-rejected with configured reason; model receives error ToolResult
- [ ] Permission `full_access`: all tools (except subagent) execute without approval prompt
- [ ] Permission inheritance: session without override uses global config; session override takes precedence
- [ ] Settings UI: permission editor functional (toggle full_access, set per-tool level, edit deny reasons)

## Files to Create/Modify

| File | Action |
|------|--------|
| `src/main/core/auto-compact.ts` | Create: threshold check, trigger logic |
| `src/main/core/orchestrator.ts` | Modify: integrate auto_compact after llm.done, add subagent orchestration |
| `src/main/core/subagent.ts` | Create: child session lifecycle, run-to-completion, summary extraction |
| `src/main/core/tool-dispatch.ts` | Modify: add subagent + todo_write to registry, integrate permission resolution |
| `src/main/security/permission.ts` | Modify: add PermissionConfig type, resolvePermission(), deny-with-reason |
| `src/main/storage/db.ts` | Modify: add `todos` table, `parent_session_id` + `permission_config` to sessions |
| `src/main/storage/todos.ts` | Create: todo CRUD operations |
| `src/shared/types.ts` | Modify: add TodoItem, PermissionConfig, PermissionLevel types |
| `src/shared/events.ts` | Modify: add `compact.auto`, `subagent.start/done` event types |
| `src/renderer/components/SettingsView.tsx` | Modify: add permission editor section |
| `src/renderer/components/TodoPanel.tsx` | Create: todo list display (sidebar or inline) |
| `src/preload/index.ts` | Modify: add todos.*, permissions.* IPC |

## Definition of Done

Sessions auto-manage context without user intervention. Subagent can be dispatched for isolated subtasks and returns results to parent. Todo list tracks multi-step progress and survives compact. Permission system enforces user-defined policies with deny-with-reason feedback to the model.
