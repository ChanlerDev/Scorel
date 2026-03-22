import { beforeEach, describe, expect, it, vi } from "vitest";
import { McpManager, type McpSession } from "../../src/main/mcp/manager.js";
import type {
  McpCallToolResult,
  McpServerConfig,
  McpToolDefinition,
} from "../../src/shared/types.js";
import { getToolEntry } from "../../src/main/core/tool-dispatch.js";

function makeConfig(overrides?: Partial<McpServerConfig>): McpServerConfig {
  return {
    id: "server-1",
    name: "filesystem",
    transport: {
      type: "stdio",
      command: "node",
      args: ["server.js"],
    },
    autoStart: true,
    enabled: true,
    capabilities: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function makeTool(name: string): McpToolDefinition {
  return {
    name,
    description: `Tool ${name}`,
    inputSchema: {
      type: "object",
      properties: {},
    },
  };
}

describe("McpManager", () => {
  let tools: McpToolDefinition[];
  let callResult: McpCallToolResult;
  let session: McpSession;
  let manager: McpManager;

  beforeEach(() => {
    tools = [makeTool("read_text")];
    callResult = {
      content: [{ type: "text", text: "hello from mcp" }],
      isError: false,
    };

    session = {
      config: makeConfig(),
      status: "disconnected",
      capabilities: { tools: { listChanged: true } },
      tools: [],
      lastError: null,
      connect: vi.fn(async function connect() {
        session.status = "ready";
        session.tools = tools;
        session.capabilities = { tools: { listChanged: true } };
      }),
      disconnect: vi.fn(async function disconnect() {
        session.status = "disconnected";
        session.tools = [];
      }),
      refreshTools: vi.fn(async () => tools),
      callTool: vi.fn(async (_name: string, _args: Record<string, unknown>) => callResult),
      ping: vi.fn(async () => undefined),
      onError: vi.fn(),
      onToolsChanged: vi.fn(),
    };

    manager = new McpManager({
      createSession: vi.fn(async () => session),
    });
  });

  it("starts a server, registers its tools, and routes calls without the namespace prefix", async () => {
    const config = makeConfig();
    manager.upsertConfig(config);

    await manager.startServer(config.id);

    expect(getToolEntry("filesystem.read_text")).toMatchObject({
      serverId: config.id,
      mcpToolName: "read_text",
      source: "mcp",
    });

    const result = await manager.callTool("filesystem.read_text", { path: "README.md" }, {
      toolCallId: "tc-1",
    });

    expect(session.callTool).toHaveBeenCalledWith("read_text", { path: "README.md" }, {
      toolCallId: "tc-1",
      onUpdate: undefined,
    });
    expect(result).toEqual(callResult);
  });

  it("stops a server and unregisters its tools", async () => {
    const config = makeConfig();
    manager.upsertConfig(config);
    await manager.startServer(config.id);

    await manager.stopServer(config.id);

    expect(getToolEntry("filesystem.read_text")).toBeUndefined();
    expect(session.disconnect).toHaveBeenCalled();
  });

  it("records an error status and avoids zombie sessions when connect fails", async () => {
    const config = makeConfig({ id: "server-2", name: "broken" });
    manager = new McpManager({
      createSession: vi.fn(async () => ({
        ...session,
        config,
        connect: vi.fn(async () => {
          throw new Error("connection refused");
        }),
      })),
    });
    manager.upsertConfig(config);

    await expect(manager.startServer(config.id)).rejects.toThrow("connection refused");

    expect(manager.listServers()).toContainEqual(expect.objectContaining({
      id: config.id,
      status: "error",
      lastError: "connection refused",
      toolCount: 0,
    }));
    expect(getToolEntry("broken.read_text")).toBeUndefined();
  });
});
