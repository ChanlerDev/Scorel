import { describe, expect, it } from "vitest";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

import {
  McpConnection,
  mcpToAgentTool,
  type McpServerConfig,
} from "./index.js";

/**
 * Creates an in-process MCP server with test tools and returns
 * a factory that produces client-side transports linked to it.
 */
const createTestTransportFactory = (
  tools: Array<{ name: string; description?: string; inputSchema?: unknown }>,
  handler: (name: string, args: Record<string, unknown>) => string,
): ((config: McpServerConfig) => Transport) => {
  return (_config: McpServerConfig) => {
    const server = new Server(
      { name: "test-server", version: "1.0.0" },
      { capabilities: { tools: {} } },
    );

    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: tools.map((t) => ({
        name: t.name,
        ...(t.description ? { description: t.description } : {}),
        inputSchema: t.inputSchema ?? { type: "object", properties: {} },
      })),
    }));

    server.setRequestHandler(CallToolRequestSchema, async (request) => ({
      content: [{ type: "text", text: handler(request.params.name, (request.params.arguments ?? {}) as Record<string, unknown>) }],
    }));

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    void server.connect(serverTransport);
    return clientTransport;
  };
};

describe("McpConnection", () => {
  it("connects to an in-memory server, lists tools, and calls a tool", async () => {
    const transportFactory = createTestTransportFactory(
      [{ name: "echo", description: "Echoes text", inputSchema: { type: "object", properties: { text: { type: "string" } } } }],
      (name, args) => name === "echo" ? (args.text as string) ?? "(empty)" : `unknown: ${name}`,
    );

    const connection = new McpConnection(
      "test-server",
      { transport: "stdio", command: "dummy" },
      { createTransport: transportFactory },
    );

    await connection.connect();
    expect(connection.connected).toBe(true);
    expect(connection.tools.length).toBe(1);
    expect(connection.tools[0]!.toolName).toBe("echo");
    expect(connection.tools[0]!.name).toBe("test-server_echo");

    const result = await connection.callTool("echo", { text: "hello world" });
    expect(result.content).toEqual([{ type: "text", text: "hello world" }]);

    await connection.close();
    expect(connection.connected).toBe(false);
  });

  it("reports status with tools after connecting", async () => {
    const transportFactory = createTestTransportFactory(
      [
        { name: "tool1", description: "First tool" },
        { name: "tool2", description: "Second tool" },
      ],
      () => "ok",
    );

    const connection = new McpConnection(
      "myserver",
      { transport: "stdio", command: "dummy" },
      { createTransport: transportFactory },
    );

    await connection.connect();
    const status = connection.status();
    expect(status.id).toBe("myserver");
    expect(status.connected).toBe(true);
    expect(status.toolCount).toBe(2);
    expect(status.tools).toEqual([
      { name: "tool1", description: "First tool" },
      { name: "tool2", description: "Second tool" },
    ]);

    await connection.close();
  });

  it("returns error result when calling tool on unconnected server", async () => {
    const connection = new McpConnection("test-server", { transport: "stdio", command: "dummy" });
    const result = await connection.callTool("echo", { text: "hello" });
    expect(result.content).toEqual([
      { type: "text", text: "MCP server test-server is not connected" },
    ]);
    expect(result.details).toEqual({
      server: "test-server",
      tool: "echo",
      error: "not_connected",
    });
  });

  it("captures connection errors and sets error state", async () => {
    const failingTransport = (): Transport => {
      throw new Error("Connection refused");
    };

    const connection = new McpConnection(
      "broken-server",
      { transport: "stdio", command: "dummy" },
      { createTransport: failingTransport },
    );

    await expect(connection.connect()).rejects.toThrow("Connection refused");
    expect(connection.connected).toBe(false);
    expect(connection.error).toBe("Connection refused");

    const status = connection.status();
    expect(status.connected).toBe(false);
    expect(status.error).toBe("Connection refused");
  });

  it("close is idempotent", async () => {
    const transportFactory = createTestTransportFactory(
      [{ name: "echo" }],
      () => "ok",
    );

    const connection = new McpConnection(
      "test-server",
      { transport: "stdio", command: "dummy" },
      { createTransport: transportFactory },
    );

    await connection.connect();
    await connection.close();
    await connection.close(); // should not throw
    expect(connection.connected).toBe(false);
  });
});

describe("mcpToAgentTool", () => {
  it("creates an AgentTool with the correct name and description", () => {
    const connection = new McpConnection("myserver", { transport: "stdio", command: "npx" });
    const tool = mcpToAgentTool(connection, {
      serverId: "myserver",
      toolName: "echo",
      name: "myserver_echo",
      description: "Echo tool",
      inputSchema: { type: "object", properties: {} },
    });
    expect(tool.name).toBe("myserver_echo");
    expect(tool.description).toBe("Echo tool");
  });

  it("uses default description when none provided", () => {
    const connection = new McpConnection("myserver", { transport: "stdio", command: "npx" });
    const tool = mcpToAgentTool(connection, {
      serverId: "myserver",
      toolName: "echo",
      name: "myserver_echo",
      inputSchema: { type: "object", properties: {} },
    });
    expect(tool.description).toBe("MCP tool myserver_echo from server myserver");
  });

  it("forwards execute to connection.callTool", async () => {
    const connection = new McpConnection("myserver", { transport: "stdio", command: "npx" });
    const tool = mcpToAgentTool(connection, {
      serverId: "myserver",
      toolName: "echo",
      name: "myserver_echo",
      inputSchema: { type: "object", properties: {} },
    });
    const result = await tool.execute("call-id", { text: "hello" }, new AbortController().signal, () => undefined);
    expect(result.content).toEqual([
      { type: "text", text: "MCP server myserver is not connected" },
    ]);
  });

  it("forwards execute to a connected server and returns the result", async () => {
    const transportFactory = createTestTransportFactory(
      [{ name: "greet", description: "Greets someone", inputSchema: { type: "object", properties: { name: { type: "string" } } } }],
      (_name, args) => `Hello, ${args.name ?? "world"}!`,
    );

    const connection = new McpConnection(
      "myserver",
      { transport: "stdio", command: "dummy" },
      { createTransport: transportFactory },
    );
    await connection.connect();

    const tools = connection.tools;
    const agentTool = mcpToAgentTool(connection, tools[0]!);
    const result = await agentTool.execute("call-id", { name: "Alice" }, new AbortController().signal, () => undefined);
    expect(result.content).toEqual([{ type: "text", text: "Hello, Alice!" }]);

    await connection.close();
  });
});
