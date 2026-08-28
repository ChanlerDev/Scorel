import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

import { Type } from "@earendil-works/pi-ai";

import type { AgentTool, ToolResult } from "../tools/index.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type McpTransportKind = "stdio" | "http" | "sse";

export type McpServerConfig = {
  transport: McpTransportKind;
  /** stdio */
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  /** http / sse */
  url?: string;
  /** Optional headers for http/sse transports */
  headers?: Record<string, string>;
  /** Environment variable names whose values are injected as headers/env at connect time */
  envHeaders?: Record<string, string>;
};

export type McpServerEntry = {
  id: string;
  config: McpServerConfig;
};

export type McpServerStatus = {
  id: string;
  connected: boolean;
  toolCount: number;
  tools: Array<{ name: string; description?: string }>;
  error?: string;
};

export type McpToolDescriptor = {
  serverId: string;
  toolName: string;
  name: string;
  description?: string;
  inputSchema: unknown;
};

// ---------------------------------------------------------------------------
// McpConnection — wraps a single MCP server connection
// ---------------------------------------------------------------------------

export type McpConnectionOptions = {
  /** Optional transport factory for testing; defaults to createTransport from config. */
  createTransport?: (config: McpServerConfig) => Transport;
};

export class McpConnection {
  readonly id: string;
  readonly config: McpServerConfig;
  #client: Client | undefined;
  #tools: McpToolDescriptor[] = [];
  #connected = false;
  #error: string | undefined;
  readonly #createTransportFn: (config: McpServerConfig) => Transport;

  constructor(id: string, config: McpServerConfig, options: McpConnectionOptions = {}) {
    this.id = id;
    this.config = config;
    this.#createTransportFn = options.createTransport ?? createTransport;
  }

  get connected(): boolean {
    return this.#connected;
  }

  get tools(): readonly McpToolDescriptor[] {
    return this.#tools;
  }

  get error(): string | undefined {
    return this.#error;
  }

  async connect(): Promise<void> {
    if (this.#connected) {
      return;
    }
    try {
      const transport = this.#createTransportFn(this.config);
      this.#client = new Client(
        { name: "scorel", version: "0.0.13" },
        { capabilities: {} },
      );
      await this.#client.connect(transport);
      await this.#refreshTools();
      this.#connected = true;
      this.#error = undefined;
    } catch (cause) {
      this.#error = cause instanceof Error ? cause.message : String(cause);
      this.#connected = false;
      // Best-effort cleanup
      await this.#safeClose();
      throw cause;
    }
  }

  async #refreshTools(): Promise<void> {
    if (!this.#client) {
      this.#tools = [];
      return;
    }
    const result = await this.#client.listTools();
    this.#tools = (result.tools ?? []).map((tool) => ({
      serverId: this.id,
      toolName: tool.name,
      name: `${this.id}_${tool.name}`,
      ...(tool.description ? { description: tool.description } : {}),
      inputSchema: tool.inputSchema,
    }));
  }

  async callTool(toolName: string, args: unknown): Promise<ToolResult> {
    if (!this.#client || !this.#connected) {
      return {
        content: [{ type: "text", text: `MCP server ${this.id} is not connected` }],
        details: { server: this.id, tool: toolName, error: "not_connected" },
      };
    }
    try {
      const result = await this.#client.callTool({ name: toolName, arguments: args as Record<string, unknown> | undefined });
      const rawContent = (result.content ?? []) as Array<{ type: string; text?: string }>;
      const content = rawContent.map((block) => {
        if (block.type === "text" && typeof block.text === "string") {
          return { type: "text" as const, text: block.text };
        }
        // Pass through other content types as text-serialised JSON
        return { type: "text" as const, text: JSON.stringify(block) };
      });
      return {
        content: content.length > 0 ? content : [{ type: "text", text: "(empty result)" }],
        details: { server: this.id, tool: toolName },
      };
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      return {
        content: [{ type: "text", text: `MCP tool ${this.id}_${toolName} failed: ${message}` }],
        details: { server: this.id, tool: toolName, error: message },
      };
    }
  }

  async close(): Promise<void> {
    await this.#safeClose();
    this.#connected = false;
    this.#tools = [];
  }

  async #safeClose(): Promise<void> {
    try {
      await this.#client?.close();
    } catch {
      // Best-effort — ignore close errors
    }
    this.#client = undefined;
  }

  status(): McpServerStatus {
    return {
      id: this.id,
      connected: this.#connected,
      toolCount: this.#tools.length,
      tools: this.#tools.map((t) => ({ name: t.toolName, ...(t.description ? { description: t.description } : {}) })),
      ...(this.#error ? { error: this.#error } : {}),
    };
  }
}

// ---------------------------------------------------------------------------
// Transport creation
// ---------------------------------------------------------------------------

const createTransport = (config: McpServerConfig): Transport => {
  switch (config.transport) {
    case "stdio": {
      if (!config.command) {
        throw new Error(`mcp server command is required for stdio transport`);
      }
      return new StdioClientTransport({
        command: config.command,
        args: config.args ?? [],
        ...(config.env ? { env: config.env } : {}),
        ...(config.cwd ? { cwd: config.cwd } : {}),
      });
    }
    case "sse": {
      if (!config.url) {
        throw new Error(`mcp server url is required for sse transport`);
      }
      return new SSEClientTransport(
        new URL(config.url),
        ...(config.headers ? [{ requestInit: { headers: resolveHeaders(config.headers, config.envHeaders) } }] : []),
      );
    }
    case "http": {
      if (!config.url) {
        throw new Error(`mcp server url is required for http transport`);
      }
      return new StreamableHTTPClientTransport(
        new URL(config.url),
        ...(config.headers ? [{ requestInit: { headers: resolveHeaders(config.headers, config.envHeaders) } }] : []),
      );
    }
    default:
      throw new Error(`mcp server transport must be stdio, http, or sse`);
  }
};

const resolveHeaders = (
  headers: Record<string, string>,
  envHeaders?: Record<string, string>,
): Record<string, string> => {
  const resolved = { ...headers };
  if (envHeaders) {
    for (const [headerName, envName] of Object.entries(envHeaders)) {
      const value = process.env[envName];
      if (value) {
        resolved[headerName] = value;
      }
    }
  }
  return resolved;
};

// ---------------------------------------------------------------------------
// Tool adapter — wraps an MCP tool as an AgentTool
// ---------------------------------------------------------------------------

export const mcpToAgentTool = (connection: McpConnection, tool: McpToolDescriptor): AgentTool => ({
  name: tool.name,
  description: tool.description ?? `MCP tool ${tool.name} from server ${connection.id}`,
  parameters: Type.Unsafe(tool.inputSchema ?? { type: "object", properties: {} }),
  execute: async (_toolCallId, args) => {
    const result = await connection.callTool(tool.toolName, args);
    return result;
  },
});

// ---------------------------------------------------------------------------
// Cloud MCP registry types
// ---------------------------------------------------------------------------

export type CloudMcpServerEntry = {
  id: string;
  name: string;
  description?: string;
  transport: McpTransportKind;
  command?: string;
  args?: string[];
  url?: string;
  envHeaders?: Record<string, string>;
  tags?: string[];
};

export type CloudMcpCatalog = {
  servers: CloudMcpServerEntry[];
};

export const fetchCloudMcpCatalog = async (registryUrl: string): Promise<CloudMcpCatalog> => {
  const response = await fetch(registryUrl, {
    headers: { accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`Cloud MCP registry request failed: ${response.status} ${response.statusText}`);
  }
  const payload = (await response.json()) as CloudMcpCatalog | CloudMcpServerEntry[];
  const servers = Array.isArray(payload) ? payload : payload.servers ?? [];
  return { servers };
};

export const cloudEntryToServerConfig = (entry: CloudMcpServerEntry): McpServerConfig => ({
  transport: entry.transport,
  ...(entry.command ? { command: entry.command } : {}),
  ...(entry.args ? { args: entry.args } : {}),
  ...(entry.url ? { url: entry.url } : {}),
  ...(entry.envHeaders ? { envHeaders: entry.envHeaders } : {}),
});
