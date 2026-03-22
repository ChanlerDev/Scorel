# V1-M2 MCP Integration — Re-review (Round 2)

**Date**: 2026-03-23
**Prior review**: [v1-m2-review.md](v1-m2-review.md)
**Scope**: Fixes for P0 #1, #2, P1 #4, #5, #6 from the initial review

---

## P0 #1: Connect failure zombie session — Resolved

`src/main/mcp/manager.ts:341-360`

Session is now only added to the `sessions` map **after** successful connect. On failure, `runtimeStates` records `"error"` + `lastError`, so `listServers()` reports the failure correctly. The `McpRuntimeState` abstraction decouples "last known status" from whether a live session object exists — good design.

Test: `mcp-manager.test.ts:113-135` directly validates the zombie scenario.

## P0 #2: MCP tool timeout — Resolved

`src/main/core/orchestrator.ts:388-421`

`Promise.race` with `getToolTimeout(toolCall)` + proper cleanup in `finally`. Timeout errors map to `ToolResult { isError: true }`. Note: the underlying MCP SDK call continues after timeout (no cancellation) — acceptable for V1 but worth revisiting if resource leaks emerge.

## P0 #3: Dead `toolResult` branch — Still present

`src/main/mcp/manager.ts:166-177` — The `if ("toolResult" in response)` branch remains. Harmless dead code, lowest priority.

## P1 #4: Sequential `startAutoStartServers` — Resolved

`src/main/mcp/manager.ts:298-304` — Now `Promise.allSettled`. Individual server failures don't block others. Errors already captured in `runtimeStates` via the `startServer` catch block.

## P1 #5: Non-text MCP content — Resolved

`src/main/core/orchestrator.ts:477-505` — All content types now produce LLM-visible placeholders: `[image: image/png]`, `[audio: ...]`, `[resource: ...]`, `[resource-link: ...]`. Raw content preserved in `details.rawContent`.

Test: `orchestrator.test.ts:310-360` validates image placeholder.

## P1 #6: Forced test-before-save — Resolved

`src/renderer/components/SettingsView.tsx:686-713` + `src/main/ipc-handlers.ts:323-324`

Save no longer blocks on `testConnection`. Config is always persisted. `startServer` failure is caught silently in IPC handler; the returned `McpServerSummary.status` tells the UI whether connection succeeded. If `"error"`, the UI shows: `"MCP server saved, but connection failed: ..."`.

## Additional cleanup

- `inferQualifiedToolName` wrapper removed from `manager.ts` (was P2 #10)
- `runtimeStates` map added to `McpManager` — all lifecycle transitions (`upsertConfig`, `startServer`, `stopServer`, `checkHealth`, `onError`, `onToolsChanged`) update it consistently

## Remaining deferred items

- Exponential backoff reconnect (P1 #7) — health-check restart sufficient for V1
- MCP status change events to renderer (P2 #11) — UI refresh after user action sufficient for V1
- `headers`/`env` keychain separation — acknowledged, not in M2 scope
- Health check, `shutdownAll`, HTTP transport test coverage — partially addressed

**Verdict**: All actionable P0/P1 items resolved. `runtimeStates` abstraction is a net improvement over the minimal fix. Ship-ready.
