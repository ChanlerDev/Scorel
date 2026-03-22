# V1-M1 Autonomy Foundation — Implementation Review

> Reviewer: Claude | Base: `d7f0ee3` (main) | 21 files changed (+1690 / -64)

## Summary

V1-M1 implements the four autonomy pillars (A1–A4) from the spec: auto_compact, subagent, todo_write, and the permission system. Convention compliance is solid — all new types use `type`, no `any`, kebab-case files. The subagent error-handling path (try-catch-finally with `activeChildSessions` cleanup) is well-structured, and tool result errors correctly surface as `isError: true`. However, the review identified four critical issues — notably a race condition in approval dispatch, unvalidated permission IPC inputs, a permission fallback mismatch, and silently swallowed auto-compact errors — plus several high-severity gaps at the DB/IPC boundary.

---

## Re-review (Round 2)

> All critical and high-severity issues have been addressed. 22 of 23 original issues fixed; 1 remaining (M12, intentional design decision). 3 new low-severity observations added.

### Resolution Status

| ID | Severity | Issue | Status |
|---|---|---|---|
| C1 | Critical | `pendingApproval` single-slot race | **FIXED** — `Map<string, ApprovalRequest>` keyed by `toolCallId`; abort iterates by `sessionId` |
| C2 | Critical | Permission IPC unvalidated | **FIXED** — `normalizePermissionConfig(config)` called before store on both `setGlobal` and `setSession` |
| C3 | Critical | `resolvePermission` fallback mismatch | **FIXED** — Returns `{}` (no `level`); `resolveToolApproval` falls through to registry default |
| C4 | Critical | `maybeAutoCompact` swallows errors | **FIXED** — `console.error` added; `ChatView` listens for `compact.failed` and renders warning |
| H1 | High | Orphan child session | **FIXED** — API key check moved before `sessionManager.create()` |
| H2 | High | `details` type unsound | **FIXED** — Changed to `details?: unknown` |
| H3 | High | SettingsView silent permission reset | **FIXED** — `permissionsLoadError` state + `console.error` + save button disabled on load failure |
| H4 | High | TodoPanel race + silent errors | **FIXED** — Event sub before load; `hasReceivedEventRef` prevents stale overwrite; `.catch()` sets `loadError` |
| H5 | High | `parseJsonOrNull` throws | **FIXED** — try-catch + `console.error` + return `null`; test in `db-resilience.test.ts` |
| H6 | High | `updateTodo` can't clear notes | **FIXED** — `CASE WHEN @notesProvided` pattern; opts accepts `string \| null`; test in `todos.test.ts` |
| H7 | High | `executeTodoWrite` no try-catch | **FIXED** — Entire method wrapped; catch returns `isError: true` ToolResult |
| M1 | Medium | `getSubagentDepth` dead code | **FIXED** — Removed; only `canSpawnSubagent` remains |
| M2 | Medium | `SubagentStatus` duplicated | **FIXED** — `events.ts` imports from `types.ts` |
| M3 | Medium | `SubagentRunResult` dead type | **FIXED** — Removed |
| M4 | Medium | `SessionState` in wrong file | **FIXED** — Moved to `types.ts` |
| M5 | Medium | `toolDefaults` key is `string` | **FIXED** — `Partial<Record<ToolName, PermissionLevel>>` |
| M6 | Medium | `getAutoCompactConfig` no validation | **FIXED** — Validates type, finiteness, and range `(0,1]` |
| M7 | Medium | DB boundary unsafe casts | **PARTIALLY FIXED** — `isTodoStatus` guard + notes sanitization + `normalizePermissionConfig` on read; structural `as TodoRow` casts remain (acceptable for schema-guaranteed columns) |
| M8 | Medium | Test asserts Map order | **FIXED** — `.sort()` before comparing |
| M9 | Medium | `makeDeniedWithReasonResult` type | **FIXED** — Returns `ToolResult` |
| M10 | Medium | `deleteSessionTodos` duplication | **FIXED** — `db.ts` calls `deleteSessionTodos` from `todos.ts` |
| M11 | Medium | `getModelContextLimit` no logging | **FIXED** — `console.warn` on fallback |
| M12 | Medium | Default workspace `~/Scorel` | **NOT FIXED** — Intentional V1 UX decision; consider documenting in CLAUDE.md |

### Fix Quality Assessment

Fixes are not bandaid-level — they address root causes at the design layer:

- **C1**: `Map<string, ApprovalRequest>` correctly supports concurrent parent/child approval with session-scoped abort cleanup
- **C3**: `return {}` + caller fallthrough preserves separation of concerns between permission resolution and tool registry
- **H4**: `hasReceivedEventRef` is the correct pattern for IPC/event race resolution — event wins if it arrives first
- **H6**: `CASE WHEN @notesProvided` is the standard SQLite pattern for nullable-field updates with explicit null support

### New Test Coverage

- `tests/unit/db-resilience.test.ts`: Corrupted JSON returns null; dirty permission config gets normalized (filters invalid levels, unknown tools, non-string reasons)
- `tests/unit/todos.test.ts`: Clearing notes to null; non-string notes sanitized to null
- `tests/unit/tool-dispatch.test.ts:100-106`: Permission fallback to registry defaults (`read_file` → allow, `bash` → confirm)

### New Observations (Round 2)

#### N1 — SettingsView permission dropdown shows "Confirm" but runtime default may differ (Low)

**File**: `src/renderer/components/SettingsView.tsx:519`

`permissionConfig.toolDefaults[toolName] ?? "confirm"` displays "Confirm" for tools without explicit config. But at runtime, `resolveToolApproval` falls through to the registry default — `read_file` actually gets `"allow"`. Users may believe `read_file` requires approval when it does not. Data model is correct (unset tools are not stored); this is a display-only UX gap.

#### N2 — `AutoCompactInput.messages` uses inline import type (Style)

**File**: `src/main/core/auto-compact.ts:75`

Uses `import("../../shared/types.js").ScorelMessage[]` when the module already imports from the same path at line 2. Should use the module-level import.

#### N3 — `summarizeChildMessages` redundant guard could use type predicate (Style)

**File**: `src/main/core/subagent.ts:16`

`lastAssistant.role !== "assistant"` is needed for TypeScript narrowing but redundant at runtime. A type predicate on `.find()` would be cleaner:

```ts
const lastAssistant = [...messages].reverse().find(
  (m): m is AssistantMessage => m.role === "assistant"
);
```

---

## Issues (Original Review — preserved for reference)

### C1 — `pendingApproval` single-slot race: child subagent overwrites parent approval

**File**: `src/main/core/orchestrator.ts:70,422-426,496-510`

**Problem**: The Orchestrator holds a single `pendingApproval: ApprovalRequest | null` field. When a subagent child session issues a tool call requiring approval while the parent is already awaiting approval, the child's request overwrites the parent's `pendingApproval`. The parent's Promise never resolves, permanently locking the parent session in `awaiting_approval` state. The child session runs through `executeSubagent` → `runSessionPrompt` → `executeToolCalls` → `waitForApproval`, which writes to the same field. `approveToolCall`/`denyToolCall` then match the child's `toolCallId`, leaving the parent orphaned.

**Fix**: Replace the single `pendingApproval` with a `Map<string, ApprovalRequest>` keyed by `toolCallId`:

```ts
// Before
private pendingApproval: ApprovalRequest | null = null;

// After
private pendingApprovals = new Map<string, ApprovalRequest>();
```

Update `waitForApproval` to insert into the map, and `approveToolCall`/`denyToolCall` to look up by `toolCallId`.

---

### C2 — Permission IPC handlers accept untrusted input without validation

**File**: `src/main/ipc-handlers.ts:273-286`

**Problem**: `permissions:setGlobal` and `permissions:setSession` receive a `PermissionConfig` object directly from the renderer and store it without calling `normalizePermissionConfig`. The `loadAppConfig` path correctly normalizes through that function, but the write path bypasses it entirely. A typo like `"alllow"` (instead of `"allow"`) or a corrupted value would be stored silently. When `resolvePermission` encounters such a value, it won't match `"allow"` or `"deny"`, falling through to the tool registry default — which may be `"allow"`, effectively granting permissions the user intended to deny.

**Fix**: Validate before storing:

```ts
ipcMain.handle("permissions:setGlobal", async (_event, config: PermissionConfig) => {
  const normalized = normalizePermissionConfig(config);
  appConfig.permissions = normalized;
  saveAppConfig(app.getPath("userData"), appConfig);
  return appConfig.permissions;
});
```

Export `normalizePermissionConfig` from `app-config.ts`.

---

### C3 — `resolvePermission` fallback returns `"confirm"` instead of deferring to tool registry

**File**: `src/main/security/permission.ts:34-36`

**Problem**: Comment says "return undefined level to let caller use tool registry default," but the function returns `{ level: "confirm" }`. For tools like `read_file` (registry default: `"allow"`) and `todo_write` (spec: `"allow"`), when neither session nor global config has an explicit entry, users are forced to approve every call — contradicting the designed defaults.

**Fix**: Return a sentinel so the caller can distinguish "no opinion" from "explicitly confirm":

```ts
// Option A: return undefined level
return { level: undefined };

// Option B: introduce "unset" sentinel
type PermissionResolution = { level: PermissionLevel | undefined; reason?: string };
```

Then in `resolveToolApproval`, fall through to the tool registry default when level is `undefined`.

---

### C4 — `maybeAutoCompact` silently swallows errors

**File**: `src/main/core/orchestrator.ts:697-706`

**Problem**: The catch block emits `compact.failed` to the EventBus but does not log the error. No renderer code listens for or displays `compact.failed` events. Contrast with `manualCompact()` which re-throws. The user has zero indication that auto-compact is failing; the session will silently grow until hitting the context limit.

**Fix**: Log the error and surface to the user:

```ts
} catch (error: unknown) {
  console.error("[auto-compact] Failed for session", sessionId, error);
  this.eventBus.emitAppEvent({
    type: "compact.failed",
    sessionId,
    ts: Date.now(),
    error: error instanceof Error ? error.message : String(error),
  });
}
```

Also add renderer handling for `compact.failed` to show a non-blocking warning.

---

### H1 — Orphan child session on early API key check failure

**File**: `src/main/core/orchestrator.ts:852,870-872`

**Problem**: `executeSubagent` creates the child session in the DB (line 852) and emits `subagent.start` (line 860) before the API key check (line 870). If the key is missing, the function returns early. The `finally` block cleans up `activeChildSessions`, but the child session remains in the DB as an orphan, and no `subagent.done` event is emitted — the event log shows an unpaired `subagent.start`.

**Fix**: Move the API key check to before `sessionManager.create()`, or emit `subagent.done(status: "error")` on the early return path.

---

### H2 — `ToolResultMessage.details` type is unsound

**File**: `src/shared/types.ts:63-70`, `src/main/core/orchestrator.ts:417`

**Problem**: `details` is declared with a narrow shape (`rawOutput / exitCode / truncated / paths / diff`), but `todo_write` stores a `TodoItem` and `subagent` stores `{ childSessionId, turnsUsed, status }`. The `as ToolResultMessage["details"]` cast hides the mismatch. Downstream code reading `details` will encounter unexpected shapes at runtime.

**Fix**: Expand `details` to a discriminated union covering all tool result shapes, or type it as `unknown` with per-consumer type guards.

---

### H3 — `SettingsView` permission load failure silently resets to empty config

**File**: `src/renderer/components/SettingsView.tsx:133-148`

**Problem**: The `.catch()` handler resets permission state to `createEmptyPermissionConfig()` without any UI feedback. If the user then clicks "Save," their real permissions are overwritten with defaults — a destructive silent operation.

**Fix**: Show an error state and disable the save button on load failure:

```tsx
}).catch((error) => {
  if (!cancelled) {
    console.error("Failed to load permission config:", error);
    setFeedback("Failed to load permissions. Changes may overwrite existing settings.", "danger");
  }
});
```

---

### H4 — `TodoPanel` load errors silently discarded; IPC/event race condition

**File**: `src/renderer/components/TodoPanel.tsx:11-23`

**Problem**: `void load()` discards promise rejections — the component shows an empty list indistinguishable from "no todos." Additionally, `load()` is called before the event subscription is registered. If a `todo.updated` event fires between IPC dispatch and response, the stale IPC result overwrites the fresher event data.

**Fix**: Register the event listener before calling `load()`, and add `.catch()`:

```tsx
const unsubscribe = window.scorel.chat.onEvent(sessionId, (event) => {
  if (event.type === "todo.updated") setTodos(event.todos);
});

void load().catch((err) => {
  console.error("Failed to load todos:", err);
});
```

---

### H5 — `parseJsonOrNull` throws on corrupted JSON — permanently locks session

**File**: `src/main/storage/db.ts:179-182`

**Problem**: `JSON.parse(raw)` throws `SyntaxError` on malformed data. Since this is called from `getSessionDetail` → `getMeta`, a single corrupted `permission_config` row makes the session permanently unusable — every `send()` call fails with no recovery path via UI.

**Fix**: Wrap in try-catch:

```ts
function parseJsonOrNull<T>(raw: string | null): T | null {
  if (raw == null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch (error) {
    console.error("Failed to parse JSON from DB:", error);
    return null;
  }
}
```

---

### H6 — `updateTodo` COALESCE pattern cannot clear `notes`

**File**: `src/main/storage/todos.ts:64-77`

**Problem**: `COALESCE(@notes, notes)` keeps old value when `@notes` is `null`. Once notes are set, there is no way to clear them — `notes: undefined` is a no-op, and the opts type has no `null` path.

**Fix**: Use a sentinel-aware update for nullable fields:

```sql
notes = CASE WHEN @notes_provided THEN @notes ELSE notes END,
```

And update the opts type to `notes?: string | null`.

---

### H7 — `executeTodoWrite` does not try-catch DB operations

**File**: `src/main/core/orchestrator.ts:709-829`

**Problem**: `createTodo`, `updateTodo`, `deleteTodo`, and `listTodos` are synchronous `better-sqlite3` calls that can throw (`SQLITE_CONSTRAINT`, `SQLITE_BUSY`, `SQLITE_FULL`). An unhandled exception propagates through the model loop, potentially leaving the session stuck in "tooling" state with no recovery.

**Fix**: Wrap DB operations in try-catch and return `ToolResult` with `isError: true` on failure.

---

### M1 — `getSubagentDepth` is dead code with wrong semantics

**File**: `src/main/core/subagent.ts:18`

**Problem**: Returns `0` for root sessions and `SUBAGENT_MAX_DEPTH` (constant `1`) for any child — never computes actual depth. The function is defined but never called (the guard uses `canSpawnSubagent()` directly). It signals intent for depth computation but implements a binary check with a misleading name.

**Fix**: Either rename to `isChildSession()` returning boolean, or remove entirely if unused.

---

### M2 — `SubagentStatus` duplicated inline in `events.ts`

**File**: `src/main/core/subagent.ts`, `src/shared/events.ts:118`

**Problem**: `SubagentStatus` is defined in `subagent.ts`, but `events.ts` re-declares the same union inline as `"completed" | "max_turns" | "aborted" | "error"`. If one changes without the other, the system has inconsistent type definitions.

**Fix**: Move `SubagentStatus` to `shared/types.ts`, import in both files.

---

### M3 — `SubagentRunResult` type defined but never used

**File**: `src/main/core/subagent.ts`

**Problem**: The orchestrator constructs equivalent data inline as `ToolResult.details`, bypassing this type entirely. Dead type adds confusion.

**Fix**: Either use `SubagentRunResult` as the typed `details` field for subagent results, or remove it.

---

### M4 — `SessionState` type defined in `constants.ts` instead of `types.ts`

**File**: `src/shared/constants.ts:36`

**Problem**: Per CLAUDE.md convention, type aliases belong in `shared/types.ts`. All other shared types (`TodoStatus`, `PermissionLevel`, etc.) reside there.

**Fix**: Move `SessionState` to `types.ts`.

---

### M5 — `PermissionConfig.toolDefaults` key is `string` instead of `ToolName`

**File**: `src/shared/types.ts`

**Problem**: `toolDefaults: Record<string, PermissionLevel>` accepts any string key. A typo like `"basj"` instead of `"bash"` would be silently accepted. Same for `denyReasons`.

**Fix**: Use `Partial<Record<ToolName, PermissionLevel>>` and `Partial<Record<ToolName, string>>`.

---

### M6 — `getAutoCompactConfig` unsafe cast without numeric validation

**File**: `src/main/core/auto-compact.ts:29-34`

**Problem**: `settings.autoCompact as Partial<AutoCompactConfig>` is asserted without runtime validation. If `threshold` is stored as a string (e.g., `"0.9"` from manual config edit), the comparison `totalTokens / limit >= config.threshold` produces unexpected results.

**Fix**: Add runtime guards:

```ts
const threshold = typeof ac.threshold === "number" && ac.threshold > 0 && ac.threshold <= 1
  ? ac.threshold
  : AUTO_COMPACT_DEFAULT_THRESHOLD;
```

---

### M7 — DB boundary: multiple unsafe `as` casts without runtime validation

**File**: `src/main/storage/todos.ts:19,59,81,102`, `src/main/storage/db.ts:472`

**Problem**: `row.status as TodoStatus`, `as TodoRow`, `parseJsonOrNull<PermissionConfig>` — all cross the untyped SQLite boundary without validation. Data corruption silently passes through the type system.

**Fix**: Add type guard functions at the DB read boundary (e.g., `isTodoStatus(s: string): s is TodoStatus`).

---

### M8 — `getToolDefinitions` test asserts Map iteration order

**File**: `tests/unit/tool-dispatch.test.ts:86-92`

**Problem**: `expect(defs.map(…)).toEqual(["subagent", "todo_write"])` depends on Map insertion order. Reordering the registry breaks the test without any real regression.

**Fix**: Use `expect.arrayContaining` or sort before asserting.

---

### M9 — `makeDeniedWithReasonResult` return type should reuse `ToolResult`

**File**: `src/main/security/permission.ts:41`

**Problem**: Returns an inline object literal `{ toolCallId, isError, content }` — structurally identical to `ToolResult`. Per convention, should declare `ToolResult` as the return type.

**Fix**: Change return type to `ToolResult`.

---

### M10 — `deleteSessionTodos` function duplicates raw SQL in `db.ts`

**File**: `src/main/storage/todos.ts:107-112`, `src/main/storage/db.ts:526`

**Problem**: Session deletion in `db.ts` uses raw `DELETE FROM todos WHERE session_id = ?`, while `todos.ts` exports a `deleteSessionTodos` function for the same purpose. Two code paths for the same operation — if the schema changes, one may be forgotten.

**Fix**: Have `db.ts` session deletion call `deleteSessionTodos` instead of raw SQL.

---

### M11 — `getModelContextLimit` fallback to 128K without logging

**File**: `src/main/core/auto-compact.ts:23-25`

**Problem**: Unknown model IDs silently get 128K assumed context. A model with a smaller window would never trigger auto-compact; a model with a larger window wastes context capacity.

**Fix**: Log a warning on fallback.

---

### M12 — Default workspace `~/Scorel` contradicts CLAUDE.md security invariant

**File**: `src/main/app-config.ts:12-22`

**Problem**: CLAUDE.md states "Workspace must be explicitly selected at session creation; no default to home directory." The `getDefaultWorkspacePath` function returns `~/Scorel` and auto-creates it on first boot.

**Fix**: Either update CLAUDE.md to document this as an intentional V1 relaxation, or change to require explicit workspace selection.

---

## Spec Deviation Audit

| Spec Requirement | Implementation | Verdict |
|---|---|---|
| A1: auto_compact threshold config in session settings | Stored in `session.settings.autoCompact` | Matches |
| A1: trigger after `llm.done`, before next user send | `maybeAutoCompact` called in model loop | Matches |
| A1: reuse V0 manual compact pipeline | Calls `runMicroCompact` + `runManualCompact` | Matches |
| A1: emit `compact.auto` event | Event emitted + UI handler | Matches |
| A1: user can disable per session or globally | Config-based toggle | Matches |
| A2: child gets fresh messages with task as first user message | Fresh session created with task injected | Matches |
| A2: inherits parent tool registry and permissions | `permissionConfig` inherited | Matches |
| A2: max depth = 1 | `canSpawnSubagent` checks `parentSessionId` | Matches |
| A2: parent abort propagates to child | Abort delegation via `activeChildSessions` | Matches |
| A2: child stored in own session with `parent_session_id` | DB column added, linked correctly | Matches |
| A3: CRUD operations | `create`, `update`, `delete`, `list` implemented | Matches |
| A3: `approval: "allow"` | Registry entry uses `"allow"` | Matches |
| A3: todo list injected into system prompt | System prompt injection present | Matches |
| A3: survives compact | Injected from DB, not message history | Matches |
| A4: three permission levels | `"allow"`, `"confirm"`, `"deny"` | Matches |
| A4: `full_access` overrides all except subagent | `resolvePermission` guards subagent | Matches |
| A4: deny with reason | `makeDeniedWithReasonResult` with configurable message | Matches |
| A4: session inherits global, can override | Layered resolution chain | Matches |
| A4: settings UI permission editor | SettingsView extended | Matches |
| A4: unknown tools default to `"confirm"` | Fallback to registry default, then `"confirm"` for unknown tools | Matches |

---

## Systemic Observations

### 1. DB Boundary Trust (Improved)

The most impactful fix pattern was adding validation at the DB read boundary: `isTodoStatus` type guard, `normalizePermissionConfig` on deserialized permission config, and `parseJsonOrNull` try-catch. Structural `as TodoRow` casts remain for schema-guaranteed columns — this is acceptable since the schema defines the column types and migrations enforce them.

### 2. Error Handling Asymmetry (Resolved)

The asymmetry between manual and automatic operations is now addressed: `maybeAutoCompact` logs errors and surfaces them in the UI; `TodoPanel` surfaces load errors; `SettingsView` disables save on load failure. Background operations now have comparable observability to manual operations.

### 3. Permission System Fail-Open Tendency (Resolved)

All three contributing factors have been fixed: IPC inputs are validated through `normalizePermissionConfig`; the permission fallback returns `{}` (undefined level) instead of `"confirm"`; and `resolveToolApproval` correctly falls through to registry defaults. The system now fails closed — invalid permission values are filtered out during normalization, and unknown tools default to `"confirm"`.

---

## Positive Highlights

1. **Subagent lifecycle management**: `executeSubagent` try-catch-finally correctly cleans up `activeChildSessions`, emits paired start/done events, and returns structured error results
2. **Tool result error surfacing**: All tool failures return `isError: true` ToolResults with descriptive messages — model can adapt behavior
3. **Permission deny with reason**: `makeDeniedWithReasonResult` gives the model actionable feedback to adjust its approach
4. **Todo input validation**: `executeTodoWrite` validates per-operation required fields with clear error messages
5. **Migration idempotency**: DDL uses `IF NOT EXISTS`, version pragma set correctly
6. **Convention compliance**: All new types use `type` not `interface`, no `any`, kebab-case filenames throughout
7. **DB resilience** (post-fix): `parseJsonOrNull` try-catch, `normalizePermissionConfig` on read, `isTodoStatus` type guard — corrupted data degrades gracefully instead of crashing
8. **TodoPanel race fix**: `hasReceivedEventRef` pattern correctly resolves the IPC/event ordering race; event subscription registered before initial load
9. **Permission save guard**: `canSavePermissions` disables save button when load fails — prevents accidental overwrite of real config with defaults
