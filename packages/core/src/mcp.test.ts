import { describe, expect, it, vi } from "vitest";
import { createMcpToolRegistry } from "./mcp.js";
import type { McpToolClient } from "./mcp.js";
import type { ScorelMcpConfig } from "./settings.js";

function config(servers: ScorelMcpConfig["servers"]): ScorelMcpConfig {
  return { servers };
}

describe("MCP tool bridge", () => {
  it("wraps MCP tools as namespaced Scorel tools", async () => {
    const client: McpToolClient = {
      listTools: vi.fn(async () => ({
        tools: [
          {
            name: "echo",
            description: "Echo text",
            inputSchema: {
              type: "object",
              properties: { text: { type: "string" } },
              required: ["text"]
            }
          }
        ]
      })),
      callTool: vi.fn(async () => ({
        content: [{ type: "text", text: "echoed" }],
        isError: false
      })),
      close: vi.fn(async () => {})
    };

    const registry = await createMcpToolRegistry(config({
      local: { transport: "stdio", startup: "required", command: "node" }
    }), {
      connect: vi.fn(async () => client)
    });

    expect(registry.tools.map((tool) => tool.name)).toEqual(["mcp_local_echo"]);

    const result = await registry.tools[0]?.execute({
      toolCallId: "call_echo",
      args: { text: "hello" },
      signal: new AbortController().signal
    });

    expect(client.callTool).toHaveBeenCalledWith(
      { name: "echo", arguments: { text: "hello" } },
      undefined,
      { signal: expect.any(AbortSignal) }
    );
    expect(result).toMatchObject({
      isError: false,
      content: [{ type: "text", text: "echoed" }]
    });
  });

  it("turns MCP tool call failures into error tool results", async () => {
    const registry = await createMcpToolRegistry(config({
      local: { transport: "stdio", startup: "required", command: "node" }
    }), {
      connect: vi.fn(async () => ({
        listTools: async () => ({
          tools: [{ name: "fail", inputSchema: { type: "object" } }]
        }),
        callTool: async () => {
          throw new Error("mcp call failed");
        },
        close: async () => {}
      }))
    });

    const result = await registry.tools[0]?.execute({
      toolCallId: "call_fail",
      args: {},
      signal: new AbortController().signal
    });

    expect(result).toMatchObject({
      isError: true,
      content: [{ type: "text", text: "mcp call failed" }],
      details: { serverId: "local", mcpToolName: "fail" }
    });
  });

  it("skips optional MCP startup failures but throws required failures", async () => {
    const optional = await createMcpToolRegistry(config({
      optional: { transport: "stdio", startup: "optional", command: "missing" }
    }), {
      connect: vi.fn(async () => {
        throw new Error("cannot start");
      })
    });

    expect(optional.tools).toEqual([]);
    expect(optional.errors).toEqual([{ serverId: "optional", error: "cannot start" }]);

    await expect(createMcpToolRegistry(config({
      required: { transport: "stdio", startup: "required", command: "missing" }
    }), {
      connect: vi.fn(async () => {
        throw new Error("cannot start");
      })
    })).rejects.toThrow("Required MCP server required failed: cannot start");
  });

  it("rejects deterministic MCP tool name collisions", async () => {
    await expect(createMcpToolRegistry(config({
      local: { transport: "stdio", startup: "required", command: "node" }
    }), {
      connect: vi.fn(async () => ({
        listTools: async () => ({
          tools: [
            { name: "read-file", inputSchema: { type: "object" } },
            { name: "read_file", inputSchema: { type: "object" } }
          ]
        }),
        callTool: async () => ({ content: [] }),
        close: async () => {}
      }))
    })).rejects.toThrow("MCP tool name collision: mcp_local_read_file");
  });
});
