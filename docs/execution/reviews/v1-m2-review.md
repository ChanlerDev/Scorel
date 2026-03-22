# V1-M2 MCP Integration — Code Review

**Date**: 2026-03-23
**Scope**: MCP lifecycle, dynamic tool registration, execution routing, storage, IPC, UI
**Files reviewed**:
- `src/main/mcp/manager.ts`
- `src/main/core/tool-dispatch.ts`
- `src/main/core/orchestrator.ts`
- `src/main/storage/mcp-servers.ts`
- `src/main/storage/db.ts` (migration V4)
- `src/main/app-config.ts`
- `src/main/index.ts`
- `src/main/ipc-handlers.ts`
- `src/main/security/permission.ts`
- `src/preload/index.ts`
- `src/renderer/global.d.ts`
- `src/renderer/components/SettingsView.tsx`
- `src/shared/types.ts`
- `src/shared/events.ts`
- `tests/unit/mcp-manager.test.ts`
- `tests/unit/mcp-storage.test.ts`
- `tests/unit/tool-dispatch.test.ts`
- `tests/unit/orchestrator.test.ts`

**Known limitations** (acknowledged by implementer, not scored):
1. `headers`/`env` stored in SQLite, not keychain-separated
2. Settings permission editor only lists built-in tools, not per-MCP-tool
3. No chat-command MCP start/stop — Settings UI only

---

## What's done well

- Uses official `@modelcontextprotocol/sdk` (v1.27.1) instead of hand-rolling JSON-RPC — eliminates an entire class of protocol bugs
- Clean `createSession` injection makes `McpManager` fully testable with mocks
- Proper tool namespacing (`server_name.tool_name`) prevents collisions, backed by DB `UNIQUE` constraint on `name`
- MCP tools go through the same approval flow as built-in tools — no special-casing in the permission system
- Graceful shutdown chain: `abortAll()` → `shutdownRunner()` → `mcpManager.shutdownAll()` → `db.close()`
- Health monitoring with `ping()` + failure counter + auto-restart
- IPC bridge is clean and type-safe across all 4 layers (IPC handler → preload → global.d.ts → UI)
- `ToolListChangedNotificationSchema` handler enables dynamic tool re-discovery at runtime
- Progress notifications mapped through existing `tool.exec.update` event — no new plumbing needed

---

## P0 — Bugs / Correctness

### 1. `SdkMcpSession.connect()` leaves stale status on failure

**File**: `src/main/mcp/manager.ts:121-129`

```typescript
async connect(): Promise<void> {
    this.status = "connecting";
    await this.client.connect(this.transport);   // throws → status stuck at "connecting"
    this.status = "initializing";
    this.capabilities = ...;
    await this.refreshTools();                    // throws → status stuck at "initializing"
    this.status = "ready";
    this.lastError = null;
}
```

If either `client.connect()` or `refreshTools()` throws, the status remains at `"connecting"` or `"initializing"` permanently. Compounded by `startServer()` which puts the session into `this.sessions` **before** calling `connect()` (line 311 vs 312):

```typescript
this.sessions.set(serverId, session);    // session in map
await session.connect();                 // fails → broken session lingers in map
registerMcpTools(...);                   // never reached
```

The broken session then shows up in `listServers()` with a misleading status, and the health check skips it (only pings `"ready"` sessions), creating a "zombie session" with no auto-recovery.

**Fix**: Wrap `connect()` in try/catch to reset status to `"error"`, and only add session to the map after successful connection.

### 2. No timeout on MCP tool calls

**File**: `src/main/core/orchestrator.ts:388-398`

Built-in runner tools are protected by `getToolTimeout(toolCall)`, but MCP tool calls go directly to `mcpManager.callTool()` without any timeout wrapper:

```typescript
} else if (isMcpTool) {
    const mcpResult = await this.mcpManager.callTool(toolCall.name, toolCall.arguments, {
      // no timeout — hangs forever if MCP server is unresponsive
    });
```

The spec (B4) requires "Unified timeout policy". If an MCP server's tool hangs, the entire session blocks indefinitely.

**Fix**: Wrap in `Promise.race` with `getToolTimeout(toolCall)`, or add a `timeoutMs` option to `McpManager.callTool()`.

### 3. `callTool` dead code branch

**File**: `src/main/mcp/manager.ts:160-171`

```typescript
if ("toolResult" in response) {
    return {
        content: [{ type: "text", text: JSON.stringify(response.toolResult) }],
        isError: false,
        _meta: response._meta,
    };
}
```

The MCP SDK's `CallToolResult` type does NOT have a `toolResult` field. This branch is unreachable dead code — likely carried over from an older SDK version or a different response shape. Not harmful, but confusing and masks the real return path.

**Fix**: Remove the branch.

---

## P1 — Significant Concerns

### 4. `startAutoStartServers()` is sequential

**File**: `src/main/mcp/manager.ts:283-289`

```typescript
async startAutoStartServers(): Promise<void> {
    for (const config of this.configs.values()) {
        if (config.enabled && config.autoStart) {
            await this.startServer(config.id);  // one at a time
        }
    }
}
```

If 5 servers are configured and the first takes 10 seconds to initialize, all subsequent servers and the app startup are blocked.

**Fix**: Use `Promise.allSettled` for concurrent startup.

### 5. `mapMcpToolResult` silently drops non-text content

**File**: `src/main/core/orchestrator.ts:456-472`

```typescript
const textParts = mcpResult.content
    .filter((part) => part.type === "text")  // images, audio, resources → gone
    .map((part) => part.text);
```

If an MCP tool returns image content (e.g., a screenshot tool), the model-facing `content` string will be empty. The `details` preserves the raw content for UI use, but the LLM gets nothing useful.

**Fix**: Non-text content should produce a descriptive placeholder like `[image: image/png, 12KB]` in the text content.

### 6. `handleSaveMcpServer` forces test before save

**File**: `src/renderer/components/SettingsView.tsx:698`

```typescript
const probe = await window.scorel.mcp.testConnection(config);
if (!probe.ok) {
    setFeedback(probe.error ?? "MCP connection failed", "danger");
    return;  // can't save if server is unreachable
}
```

Users cannot save a server configuration when the MCP server is not currently running. This prevents preconfiguring servers for later use.

**Fix**: Make the pre-save test optional — e.g., "Save & Connect" vs "Save" distinction, or save with a warning instead of blocking.

### 7. Missing reconnect with exponential backoff

The spec (B2) requires "Auto-reconnect with exponential backoff (max 3 retries)". The current implementation uses fixed-interval health polling (30s) with a failure counter that triggers `restartServer` after 3 failures. Differences from spec:

- No exponential backoff between retries
- No connection-drop detection → reconnect (only health poll → restart)
- `restartServer` does a full stop+start, not a reconnect

Acceptable for V1 scope, but worth noting as a gap.

### 8. Test coverage gaps

The test suite covers the happy path well but misses several important scenarios:

| Missing test | Risk |
|---|---|
| `startServer` failure (connect throws) | P0 #1 untested |
| Health check ping failure → restart cycle | Core lifecycle untested |
| `testConnection` method | IPC handler assumed correct |
| `shutdownAll` | Shutdown path untested |
| `ToolListChangedNotification` handler | Dynamic re-registration untested |
| `startAutoStartServers` filtering | Startup behavior assumed correct |
| Streamable HTTP transport creation | Only stdio tested |
| `mapMcpToolResult` with non-text content | P1 #5 untested |
| `mcp:save` IPC with `enabled: false` | Stop-on-disable path untested |

---

## P2 — Code Quality

### 9. `McpSession` single-handler limitation

**File**: `src/main/mcp/manager.ts:113-119`

```typescript
onError(handler: (error: Error) => void): void {
    this.errorHandler = handler;  // overwrites previous handler
}
```

Both `onError` and `onToolsChanged` support only a single handler. If called twice, the first handler is silently replaced. Works today since only `startServer` sets them, but is a footgun for future callers.

### 10. `inferQualifiedToolName` is a no-op wrapper

**File**: `src/main/mcp/manager.ts:378-380`

```typescript
export function inferQualifiedToolName(serverName: string, toolName: string): string {
    return qualifyMcpToolName(serverName, toolName);
}
```

1:1 wrapper around `qualifyMcpToolName` with no added logic. Exported but never called in the codebase. Should be removed or used.

### 11. No MCP server status events

`events.ts` has no MCP-specific events. When an MCP server transitions from `ready` → `error` (health check failure) or gets restarted, the renderer has no way to know — the UI only refreshes after user-initiated actions.

Consider adding:

```typescript
| { type: "mcp.status_changed"; serverId: string; status: McpServerStatus; ts: number }
```

---

## P3 — Nitpicks

### 12. Redundant `mcp_servers` table columns

**File**: `src/main/storage/db.ts:161-171`

The table has `name`, `enabled`, `auto_start`, `capabilities` columns alongside the `config` JSON blob that also contains these fields. Reads only use the `config` column. The structured columns are effectively write-only. Not a bug, but worth documenting or leveraging for queries.

### 13. SettingsView MCP form could be extracted

The spec suggests creating `src/renderer/components/McpServerForm.tsx` as a separate file. The current implementation inlines it in SettingsView.tsx. Works but makes the already-large file harder to navigate.

---

## Summary

| Severity | Count | Key items |
|---|---|---|
| **P0** | 3 | Stale session status on connect failure; no MCP tool timeout; dead code branch |
| **P1** | 5 | Sequential startup; non-text content dropped; forced test-before-save; missing reconnect; test gaps |
| **P2** | 3 | Single-handler limitation; unused export; no status events |
| **P3** | 2 | Redundant DB columns; component extraction |

**Verdict**: The architecture is sound — uses the official SDK, integrates cleanly with the existing tool/approval/event system, and covers all 5 spec building blocks (B1–B5). The P0 issues (connect-failure zombie sessions, no tool timeout) should be fixed before merge. P1 items are acceptable scope cuts if documented.
