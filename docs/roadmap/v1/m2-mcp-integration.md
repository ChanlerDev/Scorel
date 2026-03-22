# V1-M2: MCP Integration

> stdio + Streamable HTTP transports + tool discovery + dynamic registration

## Goal

Open Scorel to external tool ecosystems by making MCP (Model Context Protocol) a first-class tool source alongside built-in tools. After M2, users can connect MCP servers and their tools appear in the model's tool list, go through the same approval flow, and produce the same ToolResult structure.

## Scope

### B1: MCP Server Configuration

**Problem**: V0 only supports hardcoded built-in tools. Users cannot extend Scorel's capabilities without modifying source code.

**Solution**: MCP server configuration in settings, with per-server transport and lifecycle config.

- **Config model**: `McpServerConfig { id, name, transport, command?, args?, url?, env?, autoStart, enabled }`
- **Storage**: `mcp_servers` table in SQLite + global settings JSON for app-level defaults
- **UI**: Settings panel → MCP Servers section → add/edit/remove/enable/disable
- **Validation**: test connection on save; show capability summary

### B2: Transport Layer

**Problem**: MCP defines two standard transports — both must be supported for ecosystem compatibility.

**Solution**: Transport abstraction with stdio and Streamable HTTP implementations.

- **stdio transport**: spawn child process, communicate via stdin/stdout JSON-RPC
- **Streamable HTTP transport**: HTTP POST for requests, SSE for server-initiated messages
- **Transport interface**: unified `McpTransport` abstraction hiding protocol details
- **Connection lifecycle**: connect → initialize (exchange capabilities) → ready → use → disconnect
- **Reconnection**: auto-reconnect on transport error with exponential backoff (max 3 retries, then mark server unavailable)
- **Encoding**: JSON-RPC 2.0 as per MCP specification

### B3: Tool Discovery & Registration

**Problem**: MCP servers expose tools dynamically; Scorel's tool registry is currently static.

**Solution**: Extend the tool registry to support dynamic tool sources that can appear and disappear at runtime.

- **Discovery**: on server ready, call `tools/list` to enumerate available tools
- **Schema mapping**: MCP tool `inputSchema` (JSON Schema) maps directly to `ToolEntry.schema`
- **Namespacing**: MCP tools prefixed with server name to avoid collisions (`server_name.tool_name`)
- **Registration**: dynamically add to TOOL_REGISTRY on server connect; remove on disconnect
- **Refresh**: re-discover on `notifications/tools/list_changed` from server
- **Permission**: MCP tools default to `"confirm"` unless explicitly overridden in permission config (from M1)

### B4: Tool Execution via MCP

**Problem**: MCP tools execute through the MCP server, not through the local Runner. The orchestrator must route tool calls to the correct backend.

**Solution**: Extend tool dispatch to route MCP tool calls through the MCP client.

- **Routing**: tool dispatch checks if tool name has MCP prefix → route to MCP client; otherwise → route to Runner
- **Invocation**: send `tools/call` JSON-RPC request with tool name + arguments
- **Result mapping**: MCP `CallToolResult` → Scorel `ToolResult` (content text extraction, isError mapping)
- **Timeout**: Core-owned timeout applies uniformly (MCP tools use same timeout policy as built-in tools)
- **Streaming updates**: if MCP server sends progress notifications, map to `tool_execution_update` events

### B5: Server Lifecycle Management

**Problem**: MCP servers are external processes/services that need lifecycle management.

**Solution**: McpManager handles server start/stop/health for all configured servers.

- **Auto-start**: servers marked `autoStart: true` launched on app start or session creation
- **Manual start/stop**: via Settings UI or chat command
- **Health monitoring**: periodic ping; mark unhealthy after 3 consecutive failures; auto-restart if configured
- **Graceful shutdown**: on app quit, send shutdown notification to all connected servers, then close transports
- **Resource cleanup**: on server disconnect, remove its tools from registry, cancel in-flight tool calls

## Out of Scope (V1-M2)

- MCP resource and prompt primitives (→ V2; only tools supported in M2)
- MCP sampling (server-initiated LLM requests) (→ V2)
- MCP server marketplace / discovery (→ V3)
- Server-to-server communication (→ V3)
- Custom MCP transport implementations (→ V2+)

## Key Implementation Notes

### MCP Transport Abstraction

```ts
type McpTransport = {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  send(request: JsonRpcRequest): Promise<JsonRpcResponse>;
  onNotification(handler: (notification: JsonRpcNotification) => void): void;
  onError(handler: (error: Error) => void): void;
  isConnected(): boolean;
};

type McpStdioTransportConfig = {
  type: "stdio";
  command: string;            // e.g. "npx", "python", "node"
  args: string[];             // e.g. ["-y", "@modelcontextprotocol/server-filesystem"]
  env?: Record<string, string>;
};

type McpHttpTransportConfig = {
  type: "streamable-http";
  url: string;                // e.g. "http://localhost:3000/mcp"
  headers?: Record<string, string>;
};

type McpTransportConfig = McpStdioTransportConfig | McpHttpTransportConfig;
```

### MCP Server Config & Storage

```ts
type McpServerConfig = {
  id: string;                 // nanoid(21)
  name: string;               // user-facing display name (also used as tool prefix)
  transport: McpTransportConfig;
  autoStart: boolean;
  enabled: boolean;
  capabilities?: McpCapabilities;  // cached from last initialize
  createdAt: number;
  updatedAt: number;
};
```

```sql
CREATE TABLE IF NOT EXISTS mcp_servers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  config TEXT NOT NULL,          -- JSON McpServerConfig
  enabled INTEGER NOT NULL DEFAULT 1,
  auto_start INTEGER NOT NULL DEFAULT 0,
  capabilities TEXT,            -- JSON cached capabilities
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

### MCP Client (per server)

```ts
type McpClient = {
  config: McpServerConfig;
  transport: McpTransport;
  status: "disconnected" | "connecting" | "initializing" | "ready" | "error";
  capabilities: McpCapabilities | null;
  tools: McpToolDefinition[];

  connect(): Promise<void>;
  disconnect(): Promise<void>;
  initialize(): Promise<McpCapabilities>;
  listTools(): Promise<McpToolDefinition[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<McpCallToolResult>;
};
```

### Tool Registry Extension

```ts
// Existing V0 registry:
// const TOOL_REGISTRY: Map<string, ToolEntry> = new Map([...built-in tools...]);

// V1 extension: dynamic registration
function registerMcpTools(serverName: string, tools: McpToolDefinition[]): void {
  for (const tool of tools) {
    const qualifiedName = `${serverName}.${tool.name}`;
    TOOL_REGISTRY.set(qualifiedName, {
      name: qualifiedName,
      schema: tool.inputSchema,
      approval: resolvePermission(qualifiedName, sessionConfig, globalConfig).level,
      source: "mcp",
      serverId: serverName,
      handler: async (args) => {
        const client = mcpManager.getClient(serverName);
        if (!client || client.status !== "ready") {
          return { toolCallId, isError: true, content: `MCP server "${serverName}" is not available` };
        }
        const result = await client.callTool(tool.name, args);
        return mapMcpResult(toolCallId, result);
      },
    });
  }
}

function unregisterMcpTools(serverName: string): void {
  for (const [name] of TOOL_REGISTRY) {
    if (name.startsWith(`${serverName}.`)) {
      TOOL_REGISTRY.delete(name);
    }
  }
}
```

### MCP Result Mapping

```ts
function mapMcpResult(toolCallId: string, mcpResult: McpCallToolResult): ToolResult {
  // MCP content is an array of content blocks (text, image, resource)
  const textParts = mcpResult.content
    .filter((c): c is McpTextContent => c.type === "text")
    .map((c) => c.text);

  return {
    toolCallId,
    isError: mcpResult.isError ?? false,
    content: textParts.join("\n"),
    details: {
      source: "mcp",
      rawContent: mcpResult.content,  // preserve full MCP content for UI rendering
    },
  };
}
```

### Tool Dispatch Routing (modified)

```ts
async function dispatchToolCall(toolCall: ToolCall, session: Session): Promise<ToolResult> {
  const entry = TOOL_REGISTRY.get(toolCall.name);
  if (!entry) {
    return { toolCallId: toolCall.id, isError: true, content: `Unknown tool: ${toolCall.name}` };
  }

  // Permission check (from M1 permission system)
  const { level, reason } = resolvePermission(toolCall.name, session.permissionConfig, globalConfig);
  if (level === "deny") {
    return { toolCallId: toolCall.id, isError: true, content: reason ?? `Tool "${toolCall.name}" denied by policy` };
  }
  if (level === "confirm") {
    const approved = await requestApproval(session.id, toolCall);
    if (!approved) {
      return { toolCallId: toolCall.id, isError: true, content: "Tool call denied by user" };
    }
  }

  // Route: MCP source → MCP client; built-in → Runner
  return entry.handler(toolCall.arguments);
}
```

### McpManager

```ts
type McpManager = {
  clients: Map<string, McpClient>;            // serverId → client

  startServer(config: McpServerConfig): Promise<void>;
  stopServer(serverId: string): Promise<void>;
  restartServer(serverId: string): Promise<void>;
  getClient(serverId: string): McpClient | undefined;
  getAvailableTools(): ToolEntry[];           // all tools from all ready servers
  startAutoStartServers(): Promise<void>;     // called on app launch
  shutdownAll(): Promise<void>;               // called on app quit
};
```

## Acceptance Criteria

- [ ] stdio MCP server: configure → start → tools appear in model's tool list → model can invoke → result displayed
- [ ] Streamable HTTP MCP server: same flow as stdio
- [ ] Tool namespacing: two servers with same tool name → both accessible via qualified names, no collision
- [ ] Server disconnect: tools removed from registry; in-flight call → error ToolResult
- [ ] Server reconnect: tools re-registered; model can invoke again
- [ ] `notifications/tools/list_changed`: new tools appear without manual refresh
- [ ] Permission integration: MCP tools respect session/global permission config; default = `"confirm"`
- [ ] Timeout: MCP tool call exceeding timeout → abort → error result (same behavior as built-in tools)
- [ ] Settings UI: add/edit/remove MCP server; test connection; see tool list and capabilities
- [ ] Auto-start: servers with `autoStart: true` are connected when app launches
- [ ] Graceful shutdown: app quit → all servers receive shutdown notification → transports closed
- [ ] Health monitoring: unhealthy server auto-restarted (if configured); UI shows server status

## Files to Create/Modify

| File | Action |
|------|--------|
| `src/main/mcp/mcp-manager.ts` | Create: server lifecycle, multi-client management |
| `src/main/mcp/mcp-client.ts` | Create: per-server client (initialize, listTools, callTool) |
| `src/main/mcp/transports/stdio.ts` | Create: stdio JSON-RPC transport |
| `src/main/mcp/transports/streamable-http.ts` | Create: Streamable HTTP + SSE transport |
| `src/main/mcp/transports/types.ts` | Create: McpTransport interface |
| `src/main/mcp/types.ts` | Create: MCP protocol types (JsonRpc, capabilities, tool definitions) |
| `src/main/core/tool-dispatch.ts` | Modify: add MCP routing, dynamic register/unregister |
| `src/main/storage/db.ts` | Modify: add `mcp_servers` table |
| `src/shared/types.ts` | Modify: add McpServerConfig, McpTransportConfig types |
| `src/shared/events.ts` | Modify: add `mcp.server.*` event types |
| `src/renderer/components/SettingsView.tsx` | Modify: add MCP Servers configuration section |
| `src/renderer/components/McpServerForm.tsx` | Create: MCP server add/edit form |
| `src/preload/index.ts` | Modify: add mcp.* IPC (list servers, start, stop, test) |

## Definition of Done

Users can configure MCP servers (stdio or HTTP), their tools appear seamlessly alongside built-in tools, go through the same approval flow, and produce standard ToolResults. Server lifecycle is managed automatically with health monitoring and graceful shutdown.
