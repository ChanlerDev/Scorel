# S0122: MCP Server Support

## Goal

Give Scorel users the ability to manage, connect to, and use external MCP (Model Context Protocol) servers as part of the agent runtime. MCP tools discovered from connected servers become first-class `AgentTool` entries in the runtime tool loop, alongside built-in coding tools.

## Scope

- **Config**: Add `[mcp.servers.<id>]` section to `~/.scorel/config.toml`, validated by `SCOREL_CONFIG_SCHEMA`. Each server entry declares `transport`, and transport-specific fields (`command`/`args`/`env` for stdio, `url` for http/sse). No new config source; reuses the single device-level config.
- **Transports**: Support `stdio` (spawn child process), `http` (Streamable HTTP with SSE fallback), and `sse` (legacy HTTP+SSE). The `http` transport tries Streamable HTTP first, falls back to SSE on 4xx — matching current MCP SDK guidance.
- **MCP client module** (`@scorel/core/mcp`): `McpConnection` wraps the official `@modelcontextprotocol/sdk` `Client` + transport. Provides `connect()`, `listTools()`, `callTool()`, `close()`, `isConnected()`. Error isolation: a single server failure never crashes the host or affects other servers.
- **Tool adapter**: `mcpToAgentTool()` wraps each MCP tool as an `AgentTool` with name `<serverId>_<toolName>`, forwarding `execute` to `connection.callTool()`. JSON Schema input schema is passed through as TypeBox `Type.Unsafe(schema)`.
- **Daemon integration**: `McpManager` (owned by `ScorelHost`) starts all configured servers on Host start, discovers tools, and registers them into each session lane runtime via `#registerLaneTools`. Servers reconnect on config refresh. Host shutdown disconnects all servers (no orphan child processes for stdio).
- **Protocol**: New wire request types: `list_mcp_servers`, `upsert_mcp_server`, `remove_mcp_server`, `call_mcp_tool`, `list_cloud_mcp`, `add_cloud_mcp`.
- **CLI**: `scorel mcp list`, `scorel mcp add`, `scorel mcp remove`, `scorel mcp call`, `scorel mcp cloud list`, `scorel mcp cloud add`.
- **GUI settings**: MCP management section showing server list, status, add/remove form, and cloud registry browser.
- **Cloud MCP registry**: `list_cloud_mcp` fetches a catalog from a configurable registry URL (default `https://registry.modelcontextprotocol.io`). `add_cloud_mcp` writes a server entry from a catalog item into config. No hardcoded endpoints or tokens.

## Not In Scope

- MCP Tier 2 keyword-triggered dynamic loading.
- MCP resources and prompts (only tools in v1).
- OAuth/auth flow for MCP servers (env-based credentials only).
- Extension-manifest MCP (`mcp` field in `scorel.extension.json` remains parse-only).
- Project-level MCP config (device-level config only, same as all other config sections).
- Permission policy for MCP tools (same default-allow as built-in tools).

## Acceptance Criteria

- A user can add a stdio MCP server via CLI (`scorel mcp add myserver --transport stdio --command npx --args -y @modelcontextprotocol/server-everything`) and see it in `scorel mcp list`.
- A user can add an HTTP MCP server via CLI (`scorel mcp add myhttp --transport http --url https://example.com/mcp`).
- Config is persisted to `~/.scorel/config.toml` under `[mcp.servers.<id>]` and survives restart.
- On session start, configured MCP servers connect and their tools are registered in the runtime. A tool from an MCP server can be invoked by the agent during a turn.
- A failed MCP server connection produces a diagnostic and does not prevent other servers or the session from starting.
- `scorel mcp call <server> <tool> [json-args]` invokes a tool directly and prints the result.
- `scorel mcp cloud list` fetches and displays a catalog from the registry URL.
- `scorel mcp cloud add <catalog-id>` writes a server entry to config.
- GUI settings shows MCP servers with status, supports add/remove, and includes cloud registry browsing.
- `pnpm typecheck && pnpm test` passes.

## Test Requirements

- Unit test: MCP config parsing and rendering round-trips (add/remove/render).
- Unit test: `McpConnection` connects to an in-process MCP server (using SDK's in-memory transport or a stdio echo server), lists tools, calls a tool, and disconnects cleanly.
- Unit test: `mcpToAgentTool` produces a working `AgentTool` that forwards calls.
- Unit test: `McpManager` starts servers, collects tools, isolates failures, and disconnects all on shutdown.
- Unit test: CLI `mcp add` / `mcp list` / `mcp remove` round-trip via embedded Host.
- All tests use real local processes or in-memory transports — no mock/fake MCP protocol.

## Impact Files / Packages

- `packages/core/src/config/index.ts` — schema, loading, rendering for `[mcp.servers.*]`
- `packages/core/src/mcp/index.ts` — new module: `McpConnection`, `mcpToAgentTool`, transport creation
- `packages/core/src/index.ts` — re-export MCP module
- `packages/protocol/src/events.ts` — MCP settings types
- `packages/protocol/src/wire.ts` — MCP request types
- `packages/daemon/src/index.ts` — `McpManager`, request handlers, lane tool registration
- `apps/cli/src/mcp-cli.ts` — new CLI module
- `apps/cli/src/index.ts` — wire `mcp` subcommand
- `apps/gui/src/renderer/settings/sections/McpSection.tsx` — new settings section
- `apps/gui/src/shared/ipc.ts` — MCP IPC types
- `apps/gui/src/preload.ts` — MCP IPC bridge
- `apps/gui/src/main/gui-store.ts` — MCP IPC handlers

## Risks And Boundaries

- **Child process lifecycle**: stdio MCP servers spawn child processes. Host shutdown must terminate them. `McpManager.disconnectAll()` is called in Host `stop()`.
- **Error isolation**: Each `McpConnection` wraps connect/listTools/callTool in try/catch. A server going down mid-session returns error tool results, not crashes.
- **Config is single source**: No separate MCP config file. All MCP config lives in `~/.scorel/config.toml` alongside providers, memory, etc.
- **No secrets in config**: MCP server auth uses `env` references (environment variable names), not inline tokens. Config rendering never writes raw secrets.
- **SDK dependency**: Adds `@modelcontextprotocol/sdk` as a `@scorel/core` dependency. `zod` is already a transitive dependency via pi-ai.
