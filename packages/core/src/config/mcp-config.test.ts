import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  loadScorelConfig,
  loadScorelConfigProfile,
  renderMcpServerConfig,
  removeMcpServerConfig,
  listMcpServers,
  type UpsertMcpServerInput,
} from "./index.js";

const mkHome = async (): Promise<string> => {
  return mkdtemp(join(tmpdir(), "scorel-mcp-test-"));
};

const writeDeviceConfig = async (config: string): Promise<void> => {
  const home = process.env.HOME;
  if (!home) {
    throw new Error("HOME is not set");
  }
  await mkdir(join(home, ".scorel"), { recursive: true });
  await writeFile(join(home, ".scorel", "config.toml"), config);
};

const mkProject = async (config: string): Promise<string> => {
  const cwd = await mkdtemp(join(tmpdir(), "scorel-mcp-proj-"));
  // Ensure a minimal provider is present so loadScorelConfig doesn't reject
  const fullConfig = config.includes("[providers.")
    ? config
    : `[providers.test]
type = "builtin"
provider = "openai"
apiKeyEnv = "SCOREL_API_KEY"

${config}`;
  await writeDeviceConfig(fullConfig);
  return cwd;
};

describe("MCP config", () => {
  beforeEach(async () => {
    vi.stubEnv("HOME", await mkHome());
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("loads stdio MCP server config from TOML", async () => {
    const cwd = await mkProject(`
[mcp.servers.myserver]
transport = "stdio"
command = "npx"
args = ["-y", "@modelcontextprotocol/server-everything"]

[mcp.servers.myserver.env]
NODE_ENV = "production"
`);
    const config = await loadScorelConfigProfile({ cwd, env: { SCOREL_API_KEY: "test-key" } });
    expect(config.mcpServers).toEqual({
      myserver: {
        transport: "stdio",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-everything"],
        env: { NODE_ENV: "production" },
      },
    });
  });

  it("loads http MCP server config from TOML", async () => {
    const cwd = await mkProject(`
[mcp.servers.myhttp]
transport = "http"
url = "https://example.com/mcp"
`);
    const config = await loadScorelConfigProfile({ cwd, env: { SCOREL_API_KEY: "test-key" } });
    expect(config.mcpServers).toEqual({
      myhttp: {
        transport: "http",
        url: "https://example.com/mcp",
      },
    });
  });

  it("loads sse MCP server config with headers", async () => {
    const cwd = await mkProject(`
[mcp.servers.mysse]
transport = "sse"
url = "https://example.com/sse"

[mcp.servers.mysse.envHeaders]
Authorization = "MCP_AUTH_TOKEN"
`);
    const config = await loadScorelConfigProfile({ cwd, env: { SCOREL_API_KEY: "test-key" } });
    expect(config.mcpServers).toEqual({
      mysse: {
        transport: "sse",
        url: "https://example.com/sse",
        envHeaders: { Authorization: "MCP_AUTH_TOKEN" },
      },
    });
  });

  it("throws on missing command for stdio transport", async () => {
    const cwd = await mkProject(`
[mcp.servers.broken]
transport = "stdio"
`);
    await expect(loadScorelConfigProfile({ cwd, env: { SCOREL_API_KEY: "test-key" } })).rejects.toThrow(
      "mcp.servers.broken.command is required for stdio transport",
    );
  });

  it("throws on missing url for http transport", async () => {
    const cwd = await mkProject(`
[mcp.servers.broken]
transport = "http"
`);
    await expect(loadScorelConfigProfile({ cwd, env: { SCOREL_API_KEY: "test-key" } })).rejects.toThrow(
      "mcp.servers.broken.url is required for http transport",
    );
  });

  it("renderMcpServerConfig adds a stdio server", async () => {
    const input: UpsertMcpServerInput = {
      serverId: "testserver",
      transport: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-everything"],
    };
    const rendered = renderMcpServerConfig(input);
    expect(rendered).toContain('[mcp.servers.testserver]');
    expect(rendered).toContain('transport = "stdio"');
    expect(rendered).toContain('command = "npx"');
    expect(rendered).toContain('args = ["-y", "@modelcontextprotocol/server-everything"]');

    // Verify round-trip
    const cwd = await mkProject(rendered);
    const config = await loadScorelConfigProfile({ cwd, env: { SCOREL_API_KEY: "test-key" } });
    expect(config.mcpServers.testserver).toEqual({
      transport: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-everything"],
    });
  });

  it("renderMcpServerConfig adds an http server with env headers", async () => {
    const rendered = renderMcpServerConfig({
      serverId: "myhttp",
      transport: "http",
      url: "https://example.com/mcp",
      envHeaders: { Authorization: "MCP_AUTH_TOKEN" },
    });
    expect(rendered).toContain('[mcp.servers.myhttp]');
    expect(rendered).toContain('transport = "http"');
    expect(rendered).toContain('url = "https://example.com/mcp"');
    expect(rendered).toContain('[mcp.servers.myhttp.envHeaders]');
    expect(rendered).toContain('Authorization = "MCP_AUTH_TOKEN"');

    // Verify round-trip
    const cwd = await mkProject(rendered);
    const config = await loadScorelConfigProfile({ cwd, env: { SCOREL_API_KEY: "test-key" } });
    expect(config.mcpServers.myhttp).toEqual({
      transport: "http",
      url: "https://example.com/mcp",
      envHeaders: { Authorization: "MCP_AUTH_TOKEN" },
    });
  });

  it("renderMcpServerConfig preserves existing config sections", async () => {
    const existing = `
[providers.openai]
type = "builtin"
provider = "openai"
apiKeyEnv = "SCOREL_API_KEY"
`;
    const rendered = renderMcpServerConfig({
      serverId: "myserver",
      transport: "stdio",
      command: "npx",
      existingConfigText: existing,
    });
    expect(rendered).toContain("[providers.openai]");
    expect(rendered).toContain("[mcp.servers.myserver]");

    const cwd = await mkProject(rendered);
    const config = await loadScorelConfigProfile({ cwd, env: { SCOREL_API_KEY: "test-key" } });
    expect(config.providers.openai).toBeDefined();
    expect(config.mcpServers.myserver).toEqual({
      transport: "stdio",
      command: "npx",
    });
  });

  it("removeMcpServerConfig removes a server from existing config", async () => {
    const existing = renderMcpServerConfig({
      serverId: "todelete",
      transport: "stdio",
      command: "npx",
    });
    const rendered = removeMcpServerConfig({
      serverId: "todelete",
      existingConfigText: existing,
    });
    expect(rendered).not.toContain("[mcp.servers.todelete]");

    const cwd = await mkProject(rendered);
    const config = await loadScorelConfigProfile({ cwd, env: { SCOREL_API_KEY: "test-key" } });
    expect(config.mcpServers.todelete).toBeUndefined();
  });

  it("renderMcpServerConfig updates an existing server", async () => {
    const existing = renderMcpServerConfig({
      serverId: "myserver",
      transport: "stdio",
      command: "old-command",
    });
    const updated = renderMcpServerConfig({
      serverId: "myserver",
      transport: "stdio",
      command: "new-command",
      args: ["--flag"],
      existingConfigText: existing,
    });
    expect(updated).not.toContain("old-command");
    expect(updated).toContain("new-command");

    const cwd = await mkProject(updated);
    const config = await loadScorelConfigProfile({ cwd, env: { SCOREL_API_KEY: "test-key" } });
    expect(config.mcpServers.myserver).toEqual({
      transport: "stdio",
      command: "new-command",
      args: ["--flag"],
    });
  });

  it("listMcpServers returns summaries", async () => {
    const cwd = await mkProject(`
[mcp.servers.server1]
transport = "stdio"
command = "npx"

[mcp.servers.server2]
transport = "http"
url = "https://example.com/mcp"
`);
    const config = await loadScorelConfigProfile({ cwd, env: { SCOREL_API_KEY: "test-key" } });
    const summaries = listMcpServers(config);
    expect(summaries).toHaveLength(2);
    expect(summaries.find((s) => s.serverId === "server1")).toEqual({
      serverId: "server1",
      transport: "stdio",
      command: "npx",
    });
    expect(summaries.find((s) => s.serverId === "server2")).toEqual({
      serverId: "server2",
      transport: "http",
      url: "https://example.com/mcp",
    });
  });

  it("handles empty mcpServers in config profile", async () => {
    const cwd = await mkProject(`
[providers.openai]
type = "builtin"
provider = "openai"
apiKeyEnv = "SCOREL_API_KEY"
`);
    const profile = await loadScorelConfigProfile({ cwd, env: { SCOREL_API_KEY: "test-key" } });
    expect(profile.mcpServers).toEqual({});
  });

  it("strips trailing slashes from URLs", async () => {
    const rendered = renderMcpServerConfig({
      serverId: "myserver",
      transport: "http",
      url: "https://example.com/mcp///",
    });
    expect(rendered).toContain('url = "https://example.com/mcp"');
  });
});
