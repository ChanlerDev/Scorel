import {
  McpConnection,
  mcpToAgentTool,
  type AgentTool,
  type McpServerConfig,
  type McpServerStatus,
} from "@scorel/core";
import type { McpServerStatusSummary } from "@scorel/protocol";

export type McpManagerOptions = {
  scorelHomeDir: string;
  appendDiagnostic: (event: string, fields?: Record<string, unknown>) => Promise<void>;
  /** Optional override for creating MCP connections (testing). */
  createConnection?: (id: string, config: McpServerConfig) => McpConnection;
};

export class McpManager {
  readonly #connections = new Map<string, McpConnection>();
  readonly #appendDiagnostic: (event: string, fields?: Record<string, unknown>) => Promise<void>;
  readonly #createConnection: (id: string, config: McpServerConfig) => McpConnection;

  constructor(options: McpManagerOptions) {
    this.#appendDiagnostic = options.appendDiagnostic;
    this.#createConnection = options.createConnection ?? ((id, config) => new McpConnection(id, config));
  }

  async startServers(configs: Record<string, McpServerConfig>): Promise<void> {
    // Stop any servers that are no longer configured or have changed config
    const currentIds = new Set(Object.keys(configs));
    for (const [id, conn] of this.#connections) {
      if (!currentIds.has(id)) {
        await this.#stopServer(id, "config_removed");
      }
    }

    // Start or restart servers
    for (const [id, config] of Object.entries(configs)) {
      const existing = this.#connections.get(id);
      if (existing) {
        // Already connected — skip unless config changed (simplified: skip for now)
        continue;
      }
      await this.#startServer(id, config);
    }
  }

  async #startServer(id: string, config: McpServerConfig): Promise<void> {
    const connection = this.#createConnection(id, config);
    try {
      await connection.connect();
      this.#connections.set(id, connection);
      await this.#appendDiagnostic("mcp_server_started", {
        serverId: id,
        transport: config.transport,
        toolCount: connection.tools.length,
      });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      // Store the failed connection so status reports it, but don't throw
      this.#connections.set(id, connection);
      await this.#appendDiagnostic("mcp_server_connect_failed", {
        serverId: id,
        transport: config.transport,
        message,
      });
    }
  }

  async #stopServer(id: string, reason: string): Promise<void> {
    const conn = this.#connections.get(id);
    if (!conn) {
      return;
    }
    await conn.close();
    this.#connections.delete(id);
    await this.#appendDiagnostic("mcp_server_stopped", { serverId: id, reason });
  }

  async disconnectAll(): Promise<void> {
    for (const [id, conn] of this.#connections) {
      await conn.close().catch(() => undefined);
      await this.#appendDiagnostic("mcp_server_stopped", { serverId: id, reason: "shutdown" });
    }
    this.#connections.clear();
  }

  getTools(): AgentTool[] {
    const tools: AgentTool[] = [];
    for (const conn of this.#connections.values()) {
      if (!conn.connected) {
        continue;
      }
      for (const tool of conn.tools) {
        tools.push(mcpToAgentTool(conn, tool));
      }
    }
    return tools;
  }

  getConnection(id: string): McpConnection | undefined {
    return this.#connections.get(id);
  }

  listStatuses(): McpServerStatus[] {
    return [...this.#connections.values()].map((conn) => conn.status());
  }

  toStatusSummaries(): McpServerStatusSummary[] {
    return [...this.#connections.values()].map((conn) => ({
      serverId: conn.id,
      transport: conn.config.transport,
      connected: conn.connected,
      toolCount: conn.tools.length,
      tools: conn.tools.map((t) => ({ name: t.toolName, ...(t.description ? { description: t.description } : {}) })),
      ...(conn.error ? { error: conn.error } : {}),
      ...(conn.config.command ? { command: conn.config.command } : {}),
      ...(conn.config.args ? { args: conn.config.args } : {}),
      ...(conn.config.url ? { url: conn.config.url } : {}),
    }));
  }

  hasActiveWork(): boolean {
    // stdio MCP servers have child processes; they count as active work
    return [...this.#connections.values()].some((conn) => conn.connected);
  }
}
