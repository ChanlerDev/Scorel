import { describe, expect, it } from "vitest";

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

import { McpConnection, type McpServerConfig } from "@scorel/core";

import { McpManager } from "./mcp-manager.js";

const createTestTransport = (): Transport => {
  const server = new Server(
    { name: "test-server", version: "1.0.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "ping",
        description: "Returns pong",
        inputSchema: { type: "object", properties: {} },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async () => ({
    content: [{ type: "text", text: "pong" }],
  }));

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  void server.connect(serverTransport);
  return clientTransport;
};

const createFailingTransport = (): Transport => {
  throw new Error("Connection refused");
};

const createTestConnectionFn = (transportFactory: () => Transport) => {
  return (id: string, config: McpServerConfig): McpConnection =>
    new McpConnection(id, config, {
      createTransport: () => transportFactory(),
    });
};

describe("McpManager", () => {
  it("starts servers and collects tools", async () => {
    const manager = new McpManager({
      scorelHomeDir: "/tmp",
      appendDiagnostic: async () => undefined,
      createConnection: createTestConnectionFn(createTestTransport),
    });

    await manager.startServers({
      server1: { transport: "stdio", command: "dummy" },
    });

    expect(manager.listStatuses()).toHaveLength(1);
    expect(manager.listStatuses()[0]!.id).toBe("server1");
    expect(manager.listStatuses()[0]!.connected).toBe(true);
    expect(manager.listStatuses()[0]!.toolCount).toBe(1);

    const tools = manager.getTools();
    expect(tools).toHaveLength(1);
    expect(tools[0]!.name).toBe("server1_ping");

    await manager.disconnectAll();
  });

  it("disconnectAll clears all connections", async () => {
    const manager = new McpManager({
      scorelHomeDir: "/tmp",
      appendDiagnostic: async () => undefined,
      createConnection: createTestConnectionFn(createTestTransport),
    });

    await manager.startServers({
      server1: { transport: "stdio", command: "dummy" },
    });
    expect(manager.hasActiveWork()).toBe(true);

    await manager.disconnectAll();
    expect(manager.listStatuses()).toEqual([]);
    expect(manager.hasActiveWork()).toBe(false);
  });

  it("toStatusSummaries returns summaries with transport and serverId", async () => {
    const manager = new McpManager({
      scorelHomeDir: "/tmp",
      appendDiagnostic: async () => undefined,
      createConnection: createTestConnectionFn(createTestTransport),
    });

    await manager.startServers({
      myhttp: { transport: "http", url: "https://example.com/mcp" },
    });

    const summaries = manager.toStatusSummaries();
    expect(summaries).toHaveLength(1);
    expect(summaries[0]!.serverId).toBe("myhttp");
    expect(summaries[0]!.transport).toBe("http");
    expect(summaries[0]!.connected).toBe(true);
    expect(summaries[0]!.url).toBe("https://example.com/mcp");

    await manager.disconnectAll();
  });

  it("getConnection returns the connection for a known server", async () => {
    const manager = new McpManager({
      scorelHomeDir: "/tmp",
      appendDiagnostic: async () => undefined,
      createConnection: createTestConnectionFn(createTestTransport),
    });

    await manager.startServers({
      server1: { transport: "stdio", command: "dummy" },
    });

    const conn = manager.getConnection("server1");
    expect(conn).toBeDefined();
    expect(conn!.id).toBe("server1");

    await manager.disconnectAll();
  });

  it("getConnection returns undefined for unknown server", () => {
    const manager = new McpManager({
      scorelHomeDir: "/tmp",
      appendDiagnostic: async () => undefined,
    });
    expect(manager.getConnection("unknown")).toBeUndefined();
  });

  it("getTools returns empty array when no servers are connected", () => {
    const manager = new McpManager({
      scorelHomeDir: "/tmp",
      appendDiagnostic: async () => undefined,
    });
    expect(manager.getTools()).toEqual([]);
  });

  it("removes servers that are no longer in config", async () => {
    const manager = new McpManager({
      scorelHomeDir: "/tmp",
      appendDiagnostic: async () => undefined,
      createConnection: createTestConnectionFn(createTestTransport),
    });

    await manager.startServers({
      server1: { transport: "stdio", command: "dummy" },
      server2: { transport: "stdio", command: "dummy" },
    });
    expect(manager.listStatuses()).toHaveLength(2);

    // Reconfigure with only server1
    await manager.startServers({
      server1: { transport: "stdio", command: "dummy" },
    });
    expect(manager.listStatuses()).toHaveLength(1);
    expect(manager.listStatuses()[0]!.id).toBe("server1");

    await manager.disconnectAll();
  });
});

describe("McpManager error isolation", () => {
  it("a failed server does not prevent others from connecting", async () => {
    const diagnostics: Array<{ event: string; serverId?: string }> = [];
    const manager = new McpManager({
      scorelHomeDir: "/tmp",
      appendDiagnostic: async (event, fields) => {
        diagnostics.push({ event, ...(fields?.serverId ? { serverId: fields.serverId as string } : {}) });
      },
      createConnection: (id, config) => {
        if (id === "broken") {
          return new McpConnection(id, config, {
            createTransport: () => createFailingTransport(),
          });
        }
        return new McpConnection(id, config, {
          createTransport: () => createTestTransport(),
        });
      },
    });

    await manager.startServers({
      broken: { transport: "stdio", command: "dummy" },
      good: { transport: "stdio", command: "dummy" },
    });

    // The broken server should have an error but not crash the manager
    const brokenStatus = manager.listStatuses().find((s) => s.id === "broken");
    expect(brokenStatus).toBeDefined();
    expect(brokenStatus!.connected).toBe(false);
    expect(brokenStatus!.error).toBe("Connection refused");

    // The good server should still be connected
    const goodStatus = manager.listStatuses().find((s) => s.id === "good");
    expect(goodStatus).toBeDefined();
    expect(goodStatus!.connected).toBe(true);
    expect(goodStatus!.toolCount).toBe(1);

    // Diagnostic should record the failure
    expect(diagnostics.find((d) => d.event === "mcp_server_connect_failed" && d.serverId === "broken")).toBeDefined();
    expect(diagnostics.find((d) => d.event === "mcp_server_started" && d.serverId === "good")).toBeDefined();

    await manager.disconnectAll();
  });

  it("hasActiveWork returns true when servers are connected", async () => {
    const manager = new McpManager({
      scorelHomeDir: "/tmp",
      appendDiagnostic: async () => undefined,
      createConnection: createTestConnectionFn(createTestTransport),
    });

    await manager.startServers({
      server1: { transport: "stdio", command: "dummy" },
    });
    expect(manager.hasActiveWork()).toBe(true);

    await manager.disconnectAll();
    expect(manager.hasActiveWork()).toBe(false);
  });
});
