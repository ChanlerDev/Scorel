import type Database from "better-sqlite3";
import type { McpServerConfig } from "../../shared/types.js";

type McpServerRow = {
  id: string;
  config: string;
};

function parseConfig(raw: string): McpServerConfig {
  return JSON.parse(raw) as McpServerConfig;
}

export function upsertMcpServer(db: Database.Database, config: McpServerConfig): void {
  db.prepare(
    `INSERT INTO mcp_servers
       (id, name, config, enabled, auto_start, capabilities, created_at, updated_at)
     VALUES (@id, @name, @config, @enabled, @autoStart, @capabilities, @createdAt, @updatedAt)
     ON CONFLICT(id) DO UPDATE SET
       name = @name,
       config = @config,
       enabled = @enabled,
       auto_start = @autoStart,
       capabilities = @capabilities,
       updated_at = @updatedAt`,
  ).run({
    id: config.id,
    name: config.name,
    config: JSON.stringify(config),
    enabled: config.enabled ? 1 : 0,
    autoStart: config.autoStart ? 1 : 0,
    capabilities: config.capabilities ? JSON.stringify(config.capabilities) : null,
    createdAt: config.createdAt,
    updatedAt: config.updatedAt,
  });
}

export function getMcpServer(db: Database.Database, id: string): McpServerConfig | null {
  const row = db.prepare("SELECT id, config FROM mcp_servers WHERE id = ?").get(id) as McpServerRow | undefined;
  return row ? parseConfig(row.config) : null;
}

export function listMcpServers(db: Database.Database): McpServerConfig[] {
  const rows = db.prepare("SELECT id, config FROM mcp_servers ORDER BY name").all() as McpServerRow[];
  return rows.map((row) => parseConfig(row.config));
}

export function deleteMcpServer(db: Database.Database, id: string): void {
  db.prepare("DELETE FROM mcp_servers WHERE id = ?").run(id);
}
