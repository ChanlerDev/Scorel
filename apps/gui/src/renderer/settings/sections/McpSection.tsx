import { useEffect, useState } from "react";

import type { GuiMcpServerStatusView, GuiCloudMcpServerView } from "../../../shared/ipc.js";
import { ChevronRight } from "../../icons/index.js";
import { SettingsCard } from "../SettingsCard.js";
import { SettingsHeader } from "../SettingsHeader.js";
import { SettingsRow } from "../SettingsRow.js";

export type McpSectionProps = {
  busy: boolean;
  setBusy(value: boolean): void;
  setError(message: string | null): void;
  refresh(): Promise<void>;
};

type AddFormState = {
  serverId: string;
  transport: "stdio" | "http" | "sse";
  command: string;
  args: string;
  cwd: string;
  url: string;
  env: string;
  envHeaders: string;
};

const emptyForm = (): AddFormState => ({
  serverId: "",
  transport: "stdio",
  command: "",
  args: "",
  cwd: "",
  url: "",
  env: "",
  envHeaders: "",
});

export function McpSection(props: McpSectionProps) {
  const [servers, setServers] = useState<GuiMcpServerStatusView[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState<AddFormState>(emptyForm());
  const [cloudServers, setCloudServers] = useState<GuiCloudMcpServerView[]>([]);
  const [showCloud, setShowCloud] = useState(false);
  const [cloudLoading, setCloudLoading] = useState(false);

  const refreshServers = async (): Promise<void> => {
    try {
      const result = await window.scorel.listMcpServers();
      setServers(result);
    } catch (cause) {
      props.setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  useEffect(() => {
    void refreshServers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleAdd = async (): Promise<void> => {
    if (!form.serverId.trim()) {
      props.setError("Server ID is required");
      return;
    }
    props.setBusy(true);
    try {
      const input: Parameters<typeof window.scorel.upsertMcpServer>[0] = {
        serverId: form.serverId.trim(),
        transport: form.transport,
      };
      if (form.transport === "stdio") {
        if (form.command.trim()) input.command = form.command.trim();
        if (form.args.trim()) input.args = form.args.split(/\s+/).filter(Boolean);
        if (form.cwd.trim()) input.cwd = form.cwd.trim();
        if (form.env.trim()) {
          input.env = {};
          for (const pair of form.env.split(",").map((s) => s.trim()).filter(Boolean)) {
            const eq = pair.indexOf("=");
            if (eq > 0) input.env[pair.slice(0, eq)!] = pair.slice(eq + 1);
          }
        }
      } else {
        if (form.url.trim()) input.url = form.url.trim();
      }
      if (form.envHeaders.trim()) {
        input.envHeaders = {};
        for (const pair of form.envHeaders.split(",").map((s) => s.trim()).filter(Boolean)) {
          const eq = pair.indexOf("=");
          if (eq > 0) input.envHeaders[pair.slice(0, eq)!] = pair.slice(eq + 1);
        }
      }
      await window.scorel.upsertMcpServer(input);
      await refreshServers();
      setShowAdd(false);
      setForm(emptyForm());
      props.setError(null);
    } catch (cause) {
      props.setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      props.setBusy(false);
    }
  };

  const handleRemove = async (serverId: string): Promise<void> => {
    props.setBusy(true);
    try {
      await window.scorel.removeMcpServer({ serverId });
      await refreshServers();
      props.setError(null);
    } catch (cause) {
      props.setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      props.setBusy(false);
    }
  };

  const handleLoadCloud = async (): Promise<void> => {
    setCloudLoading(true);
    try {
      const result = await window.scorel.listCloudMcp();
      setCloudServers(result.servers);
      setShowCloud(true);
      props.setError(null);
    } catch (cause) {
      props.setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setCloudLoading(false);
    }
  };

  const handleAddCloud = async (catalogId: string): Promise<void> => {
    props.setBusy(true);
    try {
      await window.scorel.addCloudMcp({ catalogId });
      await refreshServers();
      props.setError(null);
    } catch (cause) {
      props.setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      props.setBusy(false);
    }
  };

  return (
    <>
      <SettingsHeader
        title="MCP"
        subtitle="管理 MCP Server：添加、移除、查看连接状态与工具。"
      />

      <section className="settings-section">
        <h2 className="settings-section__title">已配置 MCP Server</h2>
        <SettingsCard>
          <SettingsRow
            label="MCP Server 列表"
            description="显示所有已配置的 MCP Server 及其连接状态"
            control={
              <button
                type="button"
                className="button"
                disabled={props.busy}
                onClick={() => void refreshServers()}
              >
                刷新
              </button>
            }
          />
          {servers.length === 0 ? (
            <div style={{ padding: "12px 16px", color: "var(--color-text-faint)", fontSize: 13 }}>
              暂无 MCP Server。点击下方"添加 MCP Server"添加。
            </div>
          ) : (
            servers.map((server) => (
              <details key={server.serverId} className="relay-device-row">
                <summary className="relay-device-row__summary">
                  <ChevronRight className="relay-device-row__chevron" size={14} />
                  <span
                    className={`project-tree__online${server.connected ? "" : " project-tree__online--off"}`}
                  />
                  <span className="relay-device-row__name">
                    <span className="relay-device-row__name-text">{server.serverId}</span>
                  </span>
                  <span className="relay-device-row__url">
                    {server.transport} · {server.connected ? `${server.toolCount} tools` : (server.error ?? "disconnected")}
                  </span>
                </summary>
                <div className="relay-device-row__details">
                  <div className="relay-device-row__detail">
                    <span>Transport</span>
                    <strong>{server.transport}</strong>
                  </div>
                  <div className="relay-device-row__detail">
                    <span>状态</span>
                    <strong>{server.connected ? "Connected" : "Disconnected"}</strong>
                  </div>
                  {server.command ? (
                    <div className="relay-device-row__detail">
                      <span>Command</span>
                      <strong>{server.command}{server.args ? ` ${server.args.join(" ")}` : ""}</strong>
                    </div>
                  ) : null}
                  {server.url ? (
                    <div className="relay-device-row__detail">
                      <span>URL</span>
                      <strong>{server.url}</strong>
                    </div>
                  ) : null}
                  {server.error ? (
                    <div className="relay-device-row__detail">
                      <span>Error</span>
                      <strong style={{ color: "var(--color-text-error)" }}>{server.error}</strong>
                    </div>
                  ) : null}
                  {server.tools.length > 0 ? (
                    <div className="relay-device-row__detail" style={{ flexDirection: "column", alignItems: "flex-start" }}>
                      <span>Tools</span>
                      <div style={{ marginTop: 4 }}>
                        {server.tools.map((tool) => (
                          <div key={tool.name} style={{ fontSize: 12, padding: "2px 0" }}>
                            <strong>{tool.name}</strong>
                            {tool.description ? <span style={{ color: "var(--color-text-faint)" }}> — {tool.description}</span> : null}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  <div style={{ padding: "8px 0" }}>
                    <button
                      type="button"
                      className="button button--danger"
                      disabled={props.busy}
                      onClick={() => void handleRemove(server.serverId)}
                    >
                      移除
                    </button>
                  </div>
                </div>
              </details>
            ))
          )}
        </SettingsCard>
      </section>

      <section className="settings-section">
        <h2 className="settings-section__title">添加 MCP Server</h2>
        <SettingsCard>
          {showAdd ? (
            <div style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: 12 }}>
              <SettingsRow
                label="Server ID"
                description="唯一标识符（字母、数字、下划线、连字符）"
                control={
                  <input
                    className="input-text"
                    placeholder="my-server"
                    value={form.serverId}
                    onChange={(e) => setForm((f) => ({ ...f, serverId: e.currentTarget.value }))}
                    data-testid="mcp-add-server-id"
                  />
                }
              />
              <SettingsRow
                label="Transport"
                description="stdio / http / sse"
                control={
                  <select
                    className="input-text"
                    value={form.transport}
                    onChange={(e) => setForm((f) => ({ ...f, transport: e.currentTarget.value as "stdio" | "http" | "sse" }))}
                    data-testid="mcp-add-transport"
                  >
                    <option value="stdio">stdio</option>
                    <option value="http">http</option>
                    <option value="sse">sse</option>
                  </select>
                }
              />
              {form.transport === "stdio" ? (
                <>
                  <SettingsRow
                    label="Command"
                    description="要执行的命令"
                    control={
                      <input
                        className="input-text"
                        placeholder="npx"
                        value={form.command}
                        onChange={(e) => setForm((f) => ({ ...f, command: e.currentTarget.value }))}
                        data-testid="mcp-add-command"
                      />
                    }
                  />
                  <SettingsRow
                    label="Args"
                    description="空格分隔的参数"
                    control={
                      <input
                        className="input-text"
                        placeholder="-y @modelcontextprotocol/server-everything"
                        value={form.args}
                        onChange={(e) => setForm((f) => ({ ...f, args: e.currentTarget.value }))}
                        data-testid="mcp-add-args"
                      />
                    }
                  />
                  <SettingsRow
                    label="Working Directory"
                    description="可选的工作目录"
                    control={
                      <input
                        className="input-text"
                        placeholder="/path/to/dir"
                        value={form.cwd}
                        onChange={(e) => setForm((f) => ({ ...f, cwd: e.currentTarget.value }))}
                      />
                    }
                  />
                  <SettingsRow
                    label="Env"
                    description="逗号分隔的 KEY=VALUE 环境变量"
                    control={
                      <input
                        className="input-text"
                        placeholder="NODE_ENV=production,DEBUG=true"
                        value={form.env}
                        onChange={(e) => setForm((f) => ({ ...f, env: e.currentTarget.value }))}
                      />
                    }
                  />
                </>
              ) : (
                <SettingsRow
                  label="URL"
                  description="MCP Server URL"
                  control={
                    <input
                      className="input-text"
                      placeholder="https://example.com/mcp"
                      value={form.url}
                      onChange={(e) => setForm((f) => ({ ...f, url: e.currentTarget.value }))}
                      data-testid="mcp-add-url"
                    />
                  }
                />
              )}
              <SettingsRow
                label="Env Headers"
                description="逗号分隔的 Header=ENV_VAR 映射（不存储实际值）"
                control={
                  <input
                    className="input-text"
                    placeholder="Authorization=MCP_AUTH_TOKEN"
                    value={form.envHeaders}
                    onChange={(e) => setForm((f) => ({ ...f, envHeaders: e.currentTarget.value }))}
                  />
                }
              />
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  type="button"
                  className="button"
                  disabled={props.busy}
                  onClick={() => void handleAdd()}
                  data-testid="mcp-add-submit"
                >
                  保存
                </button>
                <button
                  type="button"
                  className="button button--ghost"
                  disabled={props.busy}
                  onClick={() => { setShowAdd(false); setForm(emptyForm()); }}
                >
                  取消
                </button>
              </div>
            </div>
          ) : (
            <SettingsRow
              label="添加新 Server"
              description="配置 stdio / http / sse MCP Server"
              control={
                <button
                  type="button"
                  className="button"
                  disabled={props.busy}
                  onClick={() => setShowAdd(true)}
                  data-testid="mcp-show-add"
                >
                  添加 MCP Server
                </button>
              }
            />
          )}
        </SettingsCard>
      </section>

      <section className="settings-section">
        <h2 className="settings-section__title">Cloud MCP Registry</h2>
        <SettingsCard>
          <SettingsRow
            label="浏览 Cloud Registry"
            description="从 MCP registry 浏览并添加预配置 Server"
            control={
              <button
                type="button"
                className="button"
                disabled={props.busy || cloudLoading}
                onClick={() => void handleLoadCloud()}
                data-testid="mcp-cloud-load"
              >
                {cloudLoading ? "加载中…" : "浏览 Registry"}
              </button>
            }
          />
          {showCloud && cloudServers.length > 0 ? (
            <div style={{ padding: "12px 16px" }}>
              {cloudServers.map((server) => (
                <div
                  key={server.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "8px 0",
                    boxShadow: "inset 0 -1px 0 var(--color-border-hairline)",
                  }}
                >
                  <div>
                    <strong>{server.name}</strong>
                    <span style={{ color: "var(--color-text-faint)", marginLeft: 8 }}>
                      {server.transport} · {server.url ?? server.command ?? server.id}
                    </span>
                    {server.description ? (
                      <div style={{ fontSize: 12, color: "var(--color-text-faint)" }}>{server.description}</div>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    className="button button--ghost"
                    disabled={props.busy}
                    onClick={() => void handleAddCloud(server.id)}
                  >
                    添加
                  </button>
                </div>
              ))}
            </div>
          ) : null}
          {showCloud && cloudServers.length === 0 ? (
            <div style={{ padding: "12px 16px", color: "var(--color-text-faint)", fontSize: 13 }}>
              Registry 中没有可用的 MCP Server。
            </div>
          ) : null}
        </SettingsCard>
      </section>
    </>
  );
}
