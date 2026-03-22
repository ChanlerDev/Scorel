import { beforeEach, describe, expect, it } from "vitest";
import type Database from "better-sqlite3";
import { initDatabase } from "../../src/main/storage/db.js";
import {
  deleteMcpServer,
  getMcpServer,
  listMcpServers,
  upsertMcpServer,
} from "../../src/main/storage/mcp-servers.js";
import type { McpServerConfig } from "../../src/shared/types.js";

function makeConfig(overrides?: Partial<McpServerConfig>): McpServerConfig {
  return {
    id: "server-1",
    name: "filesystem",
    transport: {
      type: "stdio",
      command: "node",
      args: ["server.js"],
      env: {
        NODE_ENV: "test",
      },
    },
    autoStart: true,
    enabled: true,
    capabilities: {
      tools: {
        listChanged: true,
      },
    },
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe("mcp server storage", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = initDatabase(":memory:");
  });

  it("round-trips persisted MCP server configs", () => {
    const config = makeConfig();

    upsertMcpServer(db, config);

    expect(getMcpServer(db, config.id)).toEqual(config);
    expect(listMcpServers(db)).toEqual([config]);
  });

  it("updates existing MCP server configs in place", () => {
    const config = makeConfig();
    upsertMcpServer(db, config);

    const nextConfig = makeConfig({
      name: "filesystem-prod",
      enabled: false,
      autoStart: false,
      transport: {
        type: "streamable-http",
        url: "http://localhost:3000/mcp",
        headers: {
          Authorization: "Bearer test",
        },
      },
      updatedAt: 2,
    });

    upsertMcpServer(db, nextConfig);

    expect(getMcpServer(db, config.id)).toEqual(nextConfig);
    expect(listMcpServers(db)).toEqual([nextConfig]);
  });

  it("deletes MCP server configs", () => {
    const config = makeConfig();
    upsertMcpServer(db, config);

    deleteMcpServer(db, config.id);

    expect(getMcpServer(db, config.id)).toBeNull();
    expect(listMcpServers(db)).toEqual([]);
  });
});
