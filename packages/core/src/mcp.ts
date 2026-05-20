import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { Type } from "./llm.js";
import type { TSchema } from "./llm.js";
import type { ScorelMcpConfig, ScorelMcpServerConfig } from "./settings.js";
import type { ScorelTool, ScorelToolResult } from "./types.js";

export type McpToolListItem = {
  name: string;
  title?: string;
  description?: string;
  inputSchema: Record<string, unknown>;
};

export type McpToolClient = {
  listTools: () => Promise<{ tools: McpToolListItem[] }>;
  callTool: (
    params: { name: string; arguments: Record<string, unknown> },
    resultSchema?: unknown,
    options?: { signal?: AbortSignal }
  ) => Promise<{
    content?: unknown[];
    structuredContent?: Record<string, unknown>;
    isError?: boolean;
  } | { toolResult: unknown }>;
  close?: () => Promise<void>;
};

export type McpToolRegistry = {
  tools: ScorelTool[];
  errors: Array<{ serverId: string; error: string }>;
  close: () => Promise<void>;
};

export type CreateMcpToolRegistryOptions = {
  connect?: (serverId: string, config: ScorelMcpServerConfig) => Promise<McpToolClient>;
};

export async function createMcpToolRegistry(
  config: ScorelMcpConfig,
  options: CreateMcpToolRegistryOptions = {}
): Promise<McpToolRegistry> {
  const connect = options.connect ?? connectMcpServer;
  const tools: ScorelTool[] = [];
  const clients: McpToolClient[] = [];
  const errors: Array<{ serverId: string; error: string }> = [];
  const names = new Set<string>();

  for (const [serverId, serverConfig] of Object.entries(config.servers)) {
    let client: McpToolClient;
    try {
      client = await connect(serverId, serverConfig);
      clients.push(client);
      const listed = await client.listTools();
      for (const mcpTool of listed.tools) {
        const toolName = formatMcpToolName(serverId, mcpTool.name);
        if (names.has(toolName)) {
          throw new Error(`MCP tool name collision: ${toolName}`);
        }
        names.add(toolName);
        tools.push(wrapMcpTool(serverId, client, mcpTool, toolName));
      }
    } catch (error) {
      const message = errorMessage(error);
      if (serverConfig.startup === "required") {
        await closeClients(clients);
        throw new Error(`Required MCP server ${serverId} failed: ${message}`);
      }
      errors.push({ serverId, error: message });
    }
  }

  return {
    tools,
    errors,
    close: () => closeClients(clients)
  };
}

export function formatMcpToolName(serverId: string, toolName: string): string {
  return `mcp_${sanitizeToolNamePart(serverId)}_${sanitizeToolNamePart(toolName)}`;
}

async function connectMcpServer(serverId: string, config: ScorelMcpServerConfig): Promise<McpToolClient> {
  const client = new Client({ name: "scorel", version: "0.0.0" });
  if (config.transport === "stdio") {
    await client.connect(new StdioClientTransport({
      command: config.command,
      args: config.args,
      cwd: config.cwd,
      env: config.env,
      stderr: "inherit"
    }));
    return adaptSdkClient(client);
  }

  if (config.transport === "sse") {
    await client.connect(new SSEClientTransport(new URL(config.url), {
      requestInit: config.headers ? { headers: config.headers } : undefined,
      eventSourceInit: config.headers ? { fetch: (input, init) => fetch(input, { ...init, headers: config.headers }) } : undefined
    }));
    return adaptSdkClient(client);
  }

  await client.connect(new StreamableHTTPClientTransport(new URL(config.url), {
    requestInit: config.headers ? { headers: config.headers } : undefined
  }));
  return adaptSdkClient(client);
}

function adaptSdkClient(client: Client): McpToolClient {
  return {
    listTools: async () => client.listTools(),
    callTool: async (params, _resultSchema, options) => client.callTool(params, CallToolResultSchema, options),
    close: async () => client.close()
  };
}

function wrapMcpTool(serverId: string, client: McpToolClient, mcpTool: McpToolListItem, name: string): ScorelTool {
  return {
    name,
    label: mcpTool.title ?? `MCP ${serverId} ${mcpTool.name}`,
    description: mcpTool.description ?? `MCP tool ${mcpTool.name} from server ${serverId}.`,
    parameters: jsonSchemaToTypeBoxSchema(mcpTool.inputSchema),
    executionMode: "sequential",
    execute: async ({ args, signal }) => {
      try {
        signal.throwIfAborted();
        const result = await client.callTool({ name: mcpTool.name, arguments: args }, undefined, { signal });
        return mcpResultToScorelResult(result, serverId, mcpTool.name);
      } catch (error) {
        return {
          content: [{ type: "text", text: errorMessage(error) }],
          details: { serverId, mcpToolName: mcpTool.name, error: errorMessage(error) },
          isError: true
        };
      }
    }
  };
}

function jsonSchemaToTypeBoxSchema(schema: Record<string, unknown>): TSchema {
  return Type.Unsafe(schema.type === "object" ? schema : { type: "object", properties: {} });
}

function mcpResultToScorelResult(result: Awaited<ReturnType<McpToolClient["callTool"]>>, serverId: string, mcpToolName: string): ScorelToolResult {
  if ("toolResult" in result) {
    return {
      content: [{ type: "text", text: stringifyUnknown(result.toolResult) }],
      details: { serverId, mcpToolName },
      isError: false
    };
  }

  const content = (result.content ?? []).map(mcpContentToScorelContent);
  if (result.structuredContent) {
    content.push({ type: "text", text: stringifyUnknown(result.structuredContent) });
  }
  return {
    content: content.length > 0 ? content : [{ type: "text", text: "" }],
    details: { serverId, mcpToolName },
    isError: result.isError ?? false
  };
}

function mcpContentToScorelContent(content: unknown): ScorelToolResult["content"][number] {
  if (isObject(content) && content.type === "text" && typeof content.text === "string") {
    return { type: "text", text: content.text };
  }
  if (isObject(content) && content.type === "image" && typeof content.data === "string" && typeof content.mimeType === "string") {
    return { type: "image", data: content.data, mimeType: content.mimeType };
  }
  if (isObject(content) && content.type === "resource" && isObject(content.resource)) {
    if (typeof content.resource.text === "string") {
      const uri = typeof content.resource.uri === "string" ? content.resource.uri : "resource";
      return { type: "text", text: `[${uri}]\n${content.resource.text}` };
    }
  }
  return { type: "text", text: stringifyUnknown(content) };
}

async function closeClients(clients: McpToolClient[]): Promise<void> {
  await Promise.all(clients.map((client) => client.close?.()));
}

function sanitizeToolNamePart(value: string): string {
  const sanitized = value.replace(/[^A-Za-z0-9_-]+/g, "_").replace(/-+/g, "_").replace(/^_+|_+$/g, "");
  if (!sanitized) {
    throw new Error(`Invalid MCP tool name part: ${value}`);
  }
  return sanitized;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function stringifyUnknown(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  return JSON.stringify(value, null, 2) ?? String(value);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
