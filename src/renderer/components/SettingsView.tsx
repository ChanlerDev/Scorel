import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import type {
  McpServerConfig,
  McpServerSummary,
  PermissionConfig,
  PermissionLevel,
  ProviderConfig,
} from "@shared/types";
import {
  buildProviderConfig,
  getProviderPreset,
  validateProviderDraft,
  type ProviderDraft,
  type WizardProviderType,
} from "./setup-wizard-model";

type SettingsViewProps = {
  onClose: () => void;
  onProvidersChanged: (selection?: { providerId: string; modelId: string } | null) => Promise<void> | void;
};

type EditorMode = "edit" | "add";
type McpEditorMode = "edit" | "add";

type McpDraft = {
  id: string | null;
  name: string;
  transportType: "stdio" | "streamable-http";
  command: string;
  argsText: string;
  envText: string;
  cwd: string;
  url: string;
  headersText: string;
  autoStart: boolean;
  enabled: boolean;
};

const PERMISSION_TOOLS = ["bash", "read_file", "write_file", "edit_file", "subagent", "todo_write", "load_skill"] as const;
const DEFAULT_PERMISSION_LEVEL_BY_TOOL: Record<(typeof PERMISSION_TOOLS)[number], PermissionLevel> = {
  bash: "confirm",
  read_file: "allow",
  write_file: "confirm",
  edit_file: "confirm",
  subagent: "confirm",
  todo_write: "allow",
  load_skill: "allow",
};

function createEmptyPermissionConfig(): PermissionConfig {
  return {
    fullAccess: false,
    toolDefaults: {},
    denyReasons: {},
  };
}

function createEmptyMcpDraft(): McpDraft {
  return {
    id: null,
    name: "",
    transportType: "stdio",
    command: "",
    argsText: "",
    envText: "",
    cwd: "",
    url: "",
    headersText: "",
    autoStart: true,
    enabled: true,
  };
}

function stringifyStringRecord(value?: Record<string, string>): string {
  return value && Object.keys(value).length > 0 ? JSON.stringify(value, null, 2) : "";
}

function mcpServerToDraft(config: McpServerConfig): McpDraft {
  if (config.transport.type === "stdio") {
    return {
      id: config.id,
      name: config.name,
      transportType: "stdio",
      command: config.transport.command,
      argsText: (config.transport.args ?? []).join("\n"),
      envText: stringifyStringRecord(config.transport.env),
      cwd: config.transport.cwd ?? "",
      url: "",
      headersText: "",
      autoStart: config.autoStart,
      enabled: config.enabled,
    };
  }

  return {
    id: config.id,
    name: config.name,
    transportType: "streamable-http",
    command: "",
    argsText: "",
    envText: "",
    cwd: "",
    url: config.transport.url,
    headersText: stringifyStringRecord(config.transport.headers),
    autoStart: config.autoStart,
    enabled: config.enabled,
  };
}

function validateMcpDraft(draft: McpDraft): string[] {
  if (!draft.name.trim()) {
    return ["Server name is required"];
  }
  if (draft.transportType === "stdio" && !draft.command.trim()) {
    return ["Command is required for stdio MCP servers"];
  }
  if (draft.transportType === "streamable-http" && !draft.url.trim()) {
    return ["URL is required for Streamable HTTP MCP servers"];
  }
  return [];
}

function parseStringRecord(label: string, raw: string): Record<string, string> | undefined {
  const trimmed = raw.trim();
  if (!trimmed) {
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error(`${label} must be valid JSON`);
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object`);
  }

  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value !== "string") {
      throw new Error(`${label} values must all be strings`);
    }
    if (!key.trim()) {
      throw new Error(`${label} keys must be non-empty`);
    }
  }

  return parsed as Record<string, string>;
}

function buildMcpConfig(draft: McpDraft): McpServerConfig {
  const now = Date.now();
  const id = draft.id ?? globalThis.crypto.randomUUID();
  const base = {
    id,
    name: draft.name.trim(),
    autoStart: draft.autoStart,
    enabled: draft.enabled,
    capabilities: null,
    createdAt: now,
    updatedAt: now,
  };

  if (draft.transportType === "stdio") {
    return {
      ...base,
      transport: {
        type: "stdio",
        command: draft.command.trim(),
        args: draft.argsText
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean),
        env: parseStringRecord("Environment", draft.envText),
        cwd: draft.cwd.trim() || undefined,
      },
    };
  }

  return {
    ...base,
    transport: {
      type: "streamable-http",
      url: draft.url.trim(),
      headers: parseStringRecord("Headers", draft.headersText),
    },
  };
}

function createAddDraft(providerType: WizardProviderType): ProviderDraft {
  const preset = getProviderPreset(providerType);
  if (!preset) {
    throw new Error(`Unknown provider type: ${providerType}`);
  }

  return {
    displayName: preset.displayName,
    baseUrl: preset.baseUrl,
    modelId: preset.defaultModel,
    apiKey: "",
  };
}

function providerToDraft(provider: ProviderConfig, apiKey = ""): ProviderDraft {
  return {
    displayName: provider.displayName,
    baseUrl: provider.baseUrl,
    modelId: provider.models[0]?.id ?? "",
    apiKey,
  };
}

function buildUpdatedProviderConfig(provider: ProviderConfig, draft: ProviderDraft): ProviderConfig {
  const modelId = draft.modelId.trim();

  return {
    ...provider,
    displayName: draft.displayName.trim(),
    baseUrl: draft.baseUrl.trim().replace(/\/$/, ""),
    models: [{ id: modelId, displayName: modelId }],
  };
}

function isDraftDirty(provider: ProviderConfig, draft: ProviderDraft): boolean {
  const current = providerToDraft(provider);
  return current.displayName !== draft.displayName
    || current.baseUrl !== draft.baseUrl
    || current.modelId !== draft.modelId;
}

export function getUnsavedProviderTestMessage(): string {
  return "Save your changes before testing, or enter a new API key to test with.";
}

export function getPermissionsLoadFailureMessage(): string {
  return "Failed to load permissions. Changes are disabled to avoid overwriting existing settings.";
}

export function canSavePermissions(savingPermissions: boolean, permissionsLoadError: string | null): boolean {
  return !savingPermissions && permissionsLoadError == null;
}

export function getDisplayedPermissionLevel(
  toolName: (typeof PERMISSION_TOOLS)[number],
  storedLevel?: PermissionLevel,
): PermissionLevel {
  return storedLevel ?? DEFAULT_PERMISSION_LEVEL_BY_TOOL[toolName];
}

export function SettingsView({ onClose, onProvidersChanged }: SettingsViewProps) {
  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const [hasKeyById, setHasKeyById] = useState<Record<string, boolean>>({});
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);
  const [editorMode, setEditorMode] = useState<EditorMode>("edit");
  const [editDraft, setEditDraft] = useState<ProviderDraft | null>(null);
  const [addProviderType, setAddProviderType] = useState<WizardProviderType>("openai");
  const [addDraft, setAddDraft] = useState<ProviderDraft>(() => createAddDraft("openai"));
  const [status, setStatus] = useState<string | null>(null);
  const [statusTone, setStatusTone] = useState<"success" | "danger">("success");
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<"save" | "test" | "delete" | null>(null);
  const [mcpServers, setMcpServers] = useState<McpServerSummary[]>([]);
  const [selectedMcpServerId, setSelectedMcpServerId] = useState<string | null>(null);
  const [mcpEditorMode, setMcpEditorMode] = useState<McpEditorMode>("add");
  const [mcpDraft, setMcpDraft] = useState<McpDraft>(createEmptyMcpDraft());
  const [busyMcpAction, setBusyMcpAction] = useState<"save" | "test" | "delete" | "start" | "stop" | "restart" | null>(null);
  const [permissionConfig, setPermissionConfig] = useState<PermissionConfig>(createEmptyPermissionConfig());
  const [savingPermissions, setSavingPermissions] = useState(false);
  const [permissionsLoadError, setPermissionsLoadError] = useState<string | null>(null);

  const selectedProvider = useMemo(
    () => providers.find((provider) => provider.id === selectedProviderId) ?? null,
    [providers, selectedProviderId],
  );
  const selectedMcpServer = useMemo(
    () => mcpServers.find((server) => server.id === selectedMcpServerId) ?? null,
    [mcpServers, selectedMcpServerId],
  );

  const loadProviders = useCallback(async (preferredProviderId?: string | null) => {
    setLoading(true);

    try {
      const nextProviders = await window.scorel.providers.list();
      const keyEntries = await Promise.all(
        nextProviders.map(async (provider) => [provider.id, await window.scorel.secrets.has(provider.id)] as const),
      );
      const nextHasKeyById = Object.fromEntries(keyEntries);

      setProviders(nextProviders);
      setHasKeyById(nextHasKeyById);

      if (nextProviders.length === 0) {
        setSelectedProviderId(null);
        setEditorMode("add");
        setEditDraft(null);
        return;
      }

      const nextSelectedProvider = (
        (preferredProviderId
          ? nextProviders.find((provider) => provider.id === preferredProviderId)
          : null)
        ?? nextProviders[0]
        ?? null
      );

      setSelectedProviderId(nextSelectedProvider?.id ?? null);
      setEditorMode("edit");
      setEditDraft(nextSelectedProvider ? providerToDraft(nextSelectedProvider) : null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadProviders();
  }, [loadProviders]);

  const loadMcpServers = useCallback(async (preferredServerId?: string | null) => {
    const nextServers = await window.scorel.mcp.list();
    setMcpServers(nextServers);

    if (nextServers.length === 0) {
      setSelectedMcpServerId(null);
      setMcpEditorMode("add");
      setMcpDraft(createEmptyMcpDraft());
      return;
    }

    const nextSelectedServer = (
      (preferredServerId
        ? nextServers.find((server) => server.id === preferredServerId)
        : null)
      ?? nextServers[0]
      ?? null
    );

    setSelectedMcpServerId(nextSelectedServer?.id ?? null);
    setMcpEditorMode("edit");
    setMcpDraft(nextSelectedServer ? mcpServerToDraft(nextSelectedServer) : createEmptyMcpDraft());
  }, []);

  useEffect(() => {
    void loadMcpServers();
  }, [loadMcpServers]);

  useEffect(() => {
    let cancelled = false;
    window.scorel.permissions.getGlobal().then((config) => {
      if (!cancelled) {
        setPermissionConfig(config);
        setPermissionsLoadError(null);
      }
    }).catch((error: unknown) => {
      if (!cancelled) {
        setPermissionConfig(createEmptyPermissionConfig());
        const message = getPermissionsLoadFailureMessage();
        console.error("Failed to load permission config:", error);
        setPermissionsLoadError(message);
        setFeedback(message, "danger");
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const setFeedback = (message: string, tone: "success" | "danger") => {
    setStatus(message);
    setStatusTone(tone);
  };

  const handleSelectProvider = (provider: ProviderConfig) => {
    setEditorMode("edit");
    setSelectedProviderId(provider.id);
    setEditDraft(providerToDraft(provider));
    setStatus(null);
  };

  const handleSaveExisting = async () => {
    if (!selectedProvider || !editDraft) {
      return;
    }

    const validationErrors = validateProviderDraft(editDraft, { requireApiKey: false });
    if (validationErrors.length > 0) {
      setFeedback(validationErrors[0] ?? "Provider configuration is incomplete", "danger");
      return;
    }

    setBusyAction("save");
    setStatus(null);

    try {
      const nextConfig = buildUpdatedProviderConfig(selectedProvider, editDraft);
      await window.scorel.providers.upsert(nextConfig);
      if (editDraft.apiKey.trim()) {
        await window.scorel.secrets.store(selectedProvider.id, editDraft.apiKey.trim());
      }
      await loadProviders(selectedProvider.id);
      await onProvidersChanged({
        providerId: selectedProvider.id,
        modelId: nextConfig.models[0]?.id ?? editDraft.modelId.trim(),
      });
      setFeedback("Provider saved", "success");
    } catch (error: unknown) {
      setFeedback(error instanceof Error ? error.message : String(error), "danger");
    } finally {
      setBusyAction(null);
    }
  };

  const handleTestExisting = async () => {
    if (!selectedProvider || !editDraft) {
      return;
    }

    const validationErrors = validateProviderDraft(editDraft, { requireApiKey: false });
    if (validationErrors.length > 0) {
      setFeedback(validationErrors[0] ?? "Provider configuration is incomplete", "danger");
      return;
    }

    setBusyAction("test");
    setStatus(null);

    try {
      if (editDraft.apiKey.trim()) {
        const result = await window.scorel.providers.testConnection(
          buildUpdatedProviderConfig(selectedProvider, editDraft),
          editDraft.apiKey.trim(),
        );
        if (!result.ok) {
          setFeedback(result.error ?? "Connection test failed", "danger");
          return;
        }

        setFeedback("Connection succeeded", "success");
        return;
      }

      if (isDraftDirty(selectedProvider, editDraft)) {
        setFeedback(getUnsavedProviderTestMessage(), "danger");
        return;
      }

      const result = await window.scorel.providers.testExisting(selectedProvider.id);
      if (!result.ok) {
        setFeedback(result.error ?? "Connection test failed", "danger");
        return;
      }

      setFeedback("Connection succeeded", "success");
    } catch (error: unknown) {
      setFeedback(error instanceof Error ? error.message : String(error), "danger");
    } finally {
      setBusyAction(null);
    }
  };

  const handleDeleteExisting = async () => {
    if (!selectedProvider || !window.confirm(`Delete provider "${selectedProvider.displayName}"?`)) {
      return;
    }

    setBusyAction("delete");
    setStatus(null);

    try {
      await Promise.all([
        window.scorel.providers.delete(selectedProvider.id),
        window.scorel.secrets.clear(selectedProvider.id),
      ]);
      await loadProviders();
      await onProvidersChanged(null);
      setFeedback("Provider deleted", "success");
    } catch (error: unknown) {
      setFeedback(error instanceof Error ? error.message : String(error), "danger");
    } finally {
      setBusyAction(null);
    }
  };

  const handleSaveNewProvider = async () => {
    const validationErrors = validateProviderDraft(addDraft);
    if (validationErrors.length > 0) {
      setFeedback(validationErrors[0] ?? "Provider configuration is incomplete", "danger");
      return;
    }

    setBusyAction("save");
    setStatus(null);

    try {
      const config = buildProviderConfig({
        providerType: addProviderType,
        displayName: addDraft.displayName,
        baseUrl: addDraft.baseUrl,
        modelId: addDraft.modelId,
      });
      await window.scorel.providers.upsert(config);
      await window.scorel.secrets.store(config.id, addDraft.apiKey.trim());
      await loadProviders(config.id);
      await onProvidersChanged({
        providerId: config.id,
        modelId: config.models[0]?.id ?? addDraft.modelId.trim(),
      });
      setFeedback("Provider added", "success");
    } catch (error: unknown) {
      setFeedback(error instanceof Error ? error.message : String(error), "danger");
    } finally {
      setBusyAction(null);
    }
  };

  const handleTestNewProvider = async () => {
    const validationErrors = validateProviderDraft(addDraft);
    if (validationErrors.length > 0) {
      setFeedback(validationErrors[0] ?? "Provider configuration is incomplete", "danger");
      return;
    }

    setBusyAction("test");
    setStatus(null);

    try {
      const result = await window.scorel.providers.testConnection(
        buildProviderConfig({
          providerType: addProviderType,
          displayName: addDraft.displayName,
          baseUrl: addDraft.baseUrl,
          modelId: addDraft.modelId,
        }),
        addDraft.apiKey.trim(),
      );

      if (!result.ok) {
        setFeedback(result.error ?? "Connection test failed", "danger");
        return;
      }

      setFeedback("Connection succeeded", "success");
    } catch (error: unknown) {
      setFeedback(error instanceof Error ? error.message : String(error), "danger");
    } finally {
      setBusyAction(null);
    }
  };

  const renderProviderEditor = () => {
    if (editorMode === "add") {
      return (
        <div style={{ display: "grid", gap: 16 }}>
          <div>
            <div style={sectionTitleStyle}>Add provider</div>
            <div style={bodyTextStyle}>Create another provider without rerunning setup.</div>
          </div>
          <label style={labelStyle}>
            Provider type
            <select
              value={addProviderType}
              onChange={(event) => {
                const nextType = event.target.value as WizardProviderType;
                setAddProviderType(nextType);
                setAddDraft(createAddDraft(nextType));
                setStatus(null);
              }}
              style={inputStyle}
            >
              {(["openai", "anthropic", "custom"] as WizardProviderType[]).map((providerType) => (
                <option key={providerType} value={providerType}>
                  {getProviderPreset(providerType)?.displayName ?? providerType}
                </option>
              ))}
            </select>
          </label>
          <ProviderForm draft={addDraft} onChange={setAddDraft} apiKeyLabel="API key" />
          <div style={actionsRowStyle}>
            <button style={secondaryButtonStyle} onClick={() => void handleTestNewProvider()} disabled={busyAction !== null}>
              {busyAction === "test" ? "Testing…" : "Test Connection"}
            </button>
            <button style={primaryButtonStyle} onClick={() => void handleSaveNewProvider()} disabled={busyAction !== null}>
              {busyAction === "save" ? "Saving…" : "Add Provider"}
            </button>
          </div>
        </div>
      );
    }

    if (!selectedProvider || !editDraft) {
      return (
        <div style={{ color: "var(--text-secondary)" }}>
          Select a provider or add a new one.
        </div>
      );
    }

    return (
      <div style={{ display: "grid", gap: 16 }}>
        <div>
          <div style={sectionTitleStyle}>Provider details</div>
          <div style={bodyTextStyle}>Update model settings, rotate keys, and verify connectivity.</div>
        </div>
        <ProviderForm
          draft={editDraft}
          onChange={setEditDraft}
          apiKeyLabel={hasKeyById[selectedProvider.id] ? "Replace API key" : "API key"}
        />
        <div
          style={{
            padding: "10px 12px",
            borderRadius: 12,
            background: "var(--bg-secondary)",
            color: hasKeyById[selectedProvider.id] ? "var(--success)" : "var(--text-secondary)",
            border: "1px solid var(--border)",
          }}
        >
          {hasKeyById[selectedProvider.id] ? "Key stored" : "No key stored"}
        </div>
        <div style={actionsRowStyle}>
          <button style={secondaryButtonStyle} onClick={() => void handleTestExisting()} disabled={busyAction !== null}>
            {busyAction === "test" ? "Testing…" : "Test Connection"}
          </button>
          <button style={secondaryButtonStyle} onClick={() => void handleDeleteExisting()} disabled={busyAction !== null}>
            {busyAction === "delete" ? "Deleting…" : "Delete"}
          </button>
          <button style={primaryButtonStyle} onClick={() => void handleSaveExisting()} disabled={busyAction !== null}>
            {busyAction === "save" ? "Saving…" : "Save Changes"}
          </button>
        </div>
      </div>
    );
  };

  const handleSavePermissions = async () => {
    setSavingPermissions(true);
    setStatus(null);

    try {
      const saved = await window.scorel.permissions.setGlobal(permissionConfig);
      setPermissionConfig(saved);
      setFeedback("Permissions saved", "success");
    } catch (error: unknown) {
      setFeedback(error instanceof Error ? error.message : String(error), "danger");
    } finally {
      setSavingPermissions(false);
    }
  };

  const handleSelectMcpServer = (server: McpServerSummary) => {
    setSelectedMcpServerId(server.id);
    setMcpEditorMode("edit");
    setMcpDraft(mcpServerToDraft(server));
    setStatus(null);
  };

  const handleTestMcpServer = async () => {
    const validationErrors = validateMcpDraft(mcpDraft);
    if (validationErrors.length > 0) {
      setFeedback(validationErrors[0] ?? "MCP server configuration is incomplete", "danger");
      return;
    }

    setBusyMcpAction("test");
    setStatus(null);

    try {
      const config = buildMcpConfig(mcpDraft);
      const result = await window.scorel.mcp.testConnection(config);
      if (!result.ok) {
        setFeedback(result.error ?? "MCP connection failed", "danger");
        return;
      }

      setFeedback(`Connection succeeded${result.tools ? ` (${result.tools.length} tools)` : ""}`, "success");
    } catch (error: unknown) {
      setFeedback(error instanceof Error ? error.message : String(error), "danger");
    } finally {
      setBusyMcpAction(null);
    }
  };

  const handleSaveMcpServer = async () => {
    const validationErrors = validateMcpDraft(mcpDraft);
    if (validationErrors.length > 0) {
      setFeedback(validationErrors[0] ?? "MCP server configuration is incomplete", "danger");
      return;
    }

    setBusyMcpAction("save");
    setStatus(null);

    try {
      const config = buildMcpConfig(mcpDraft);
      const saved = await window.scorel.mcp.save({
        ...config,
        createdAt: mcpDraft.id ? selectedMcpServer?.createdAt ?? config.createdAt : config.createdAt,
      });
      await loadMcpServers(config.id);
      if (saved?.status === "error" && saved.lastError) {
        setFeedback(`MCP server saved, but connection failed: ${saved.lastError}`, "danger");
        return;
      }

      setFeedback("MCP server saved", "success");
    } catch (error: unknown) {
      setFeedback(error instanceof Error ? error.message : String(error), "danger");
    } finally {
      setBusyMcpAction(null);
    }
  };

  const handleDeleteMcpServer = async () => {
    if (!selectedMcpServer || !window.confirm(`Delete MCP server "${selectedMcpServer.name}"?`)) {
      return;
    }

    setBusyMcpAction("delete");
    setStatus(null);

    try {
      await window.scorel.mcp.delete(selectedMcpServer.id);
      await loadMcpServers();
      setFeedback("MCP server deleted", "success");
    } catch (error: unknown) {
      setFeedback(error instanceof Error ? error.message : String(error), "danger");
    } finally {
      setBusyMcpAction(null);
    }
  };

  const handleMcpServerCommand = async (
    operation: "start" | "stop" | "restart",
  ) => {
    if (!selectedMcpServer) {
      return;
    }

    setBusyMcpAction(operation);
    setStatus(null);

    try {
      await window.scorel.mcp[operation](selectedMcpServer.id);
      await loadMcpServers(selectedMcpServer.id);
      setFeedback(
        operation === "start"
          ? "MCP server started"
          : operation === "stop"
            ? "MCP server stopped"
            : "MCP server restarted",
        "success",
      );
    } catch (error: unknown) {
      setFeedback(error instanceof Error ? error.message : String(error), "danger");
    } finally {
      setBusyMcpAction(null);
    }
  };

  const renderMcpEditor = () => {
    return (
      <div style={{ display: "grid", gap: 16 }}>
        <div>
          <div style={sectionTitleStyle}>MCP server</div>
          <div style={bodyTextStyle}>Connect external tools through stdio or Streamable HTTP.</div>
        </div>

        <McpServerForm draft={mcpDraft} onChange={setMcpDraft} />

        {selectedMcpServer ? (
          <div
            style={{
              padding: "12px 14px",
              borderRadius: 12,
              background: "var(--bg-secondary)",
              border: "1px solid var(--border)",
              display: "grid",
              gap: 6,
            }}
          >
            <div><strong>Status:</strong> {selectedMcpServer.status}</div>
            <div><strong>Tools:</strong> {selectedMcpServer.toolCount}</div>
            {selectedMcpServer.lastError ? <div><strong>Error:</strong> {selectedMcpServer.lastError}</div> : null}
          </div>
        ) : null}

        <div style={actionsRowStyle}>
          <button style={secondaryButtonStyle} onClick={() => void handleTestMcpServer()} disabled={busyMcpAction !== null}>
            {busyMcpAction === "test" ? "Testing…" : "Test Connection"}
          </button>
          {selectedMcpServer ? (
            <>
              <button style={secondaryButtonStyle} onClick={() => void handleMcpServerCommand("start")} disabled={busyMcpAction !== null}>
                {busyMcpAction === "start" ? "Starting…" : "Start"}
              </button>
              <button style={secondaryButtonStyle} onClick={() => void handleMcpServerCommand("stop")} disabled={busyMcpAction !== null}>
                {busyMcpAction === "stop" ? "Stopping…" : "Stop"}
              </button>
              <button style={secondaryButtonStyle} onClick={() => void handleMcpServerCommand("restart")} disabled={busyMcpAction !== null}>
                {busyMcpAction === "restart" ? "Restarting…" : "Restart"}
              </button>
              <button style={secondaryButtonStyle} onClick={() => void handleDeleteMcpServer()} disabled={busyMcpAction !== null}>
                {busyMcpAction === "delete" ? "Deleting…" : "Delete"}
              </button>
            </>
          ) : null}
          <button style={primaryButtonStyle} onClick={() => void handleSaveMcpServer()} disabled={busyMcpAction !== null}>
            {busyMcpAction === "save" ? "Saving…" : selectedMcpServer ? "Save Changes" : "Add Server"}
          </button>
        </div>
      </div>
    );
  };

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", background: "var(--bg-primary)" }}>
      <div style={headerStyle}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>Settings</div>
          <div style={bodyTextStyle}>Manage providers and connection secrets.</div>
        </div>
        <button style={secondaryButtonStyle} onClick={onClose}>Close</button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "280px 1fr", gap: 0, flex: 1, minHeight: 0 }}>
        <div style={sidebarStyle}>
          <button
            style={{ ...primaryButtonStyle, width: "100%" }}
            onClick={() => {
              setEditorMode("add");
              setStatus(null);
            }}
          >
            Add Provider
          </button>

          <div style={{ display: "grid", gap: 8, marginTop: 14 }}>
            {providers.map((provider) => {
              const isActive = editorMode === "edit" && provider.id === selectedProviderId;
              return (
                <button
                  key={provider.id}
                  onClick={() => handleSelectProvider(provider)}
                  style={{
                    ...listButtonStyle,
                    borderColor: isActive ? "var(--accent)" : "var(--border)",
                    background: isActive ? "var(--bg-tertiary)" : "var(--bg-primary)",
                  }}
                >
                  <div style={{ fontWeight: 600 }}>{provider.displayName}</div>
                  <div style={{ color: "var(--text-secondary)", fontSize: 12, marginTop: 4 }}>
                    {provider.models[0]?.id ?? "No model"}
                  </div>
                  <div style={{ color: hasKeyById[provider.id] ? "var(--success)" : "var(--text-secondary)", fontSize: 12, marginTop: 6 }}>
                    {hasKeyById[provider.id] ? "Key stored" : "No key"}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div style={detailPaneStyle}>
          {loading ? (
            <div style={{ color: "var(--text-secondary)" }}>Loading settings…</div>
          ) : renderProviderEditor()}

          <div style={{ marginTop: 28, display: "grid", gap: 16 }}>
            <div>
              <div style={sectionTitleStyle}>MCP Servers</div>
              <div style={bodyTextStyle}>Manage external MCP tool servers.</div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "280px 1fr", gap: 16 }}>
              <div style={sidebarStyle}>
                <button
                  style={{ ...primaryButtonStyle, width: "100%" }}
                  onClick={() => {
                    setSelectedMcpServerId(null);
                    setMcpEditorMode("add");
                    setMcpDraft(createEmptyMcpDraft());
                    setStatus(null);
                  }}
                >
                  Add MCP Server
                </button>

                <div style={{ display: "grid", gap: 8, marginTop: 14 }}>
                  {mcpServers.map((server) => {
                    const isActive = mcpEditorMode === "edit" && server.id === selectedMcpServerId;
                    return (
                      <button
                        key={server.id}
                        onClick={() => handleSelectMcpServer(server)}
                        style={{
                          ...listButtonStyle,
                          borderColor: isActive ? "var(--accent)" : "var(--border)",
                          background: isActive ? "var(--bg-tertiary)" : "var(--bg-primary)",
                        }}
                      >
                        <div style={{ fontWeight: 600 }}>{server.name}</div>
                        <div style={{ color: "var(--text-secondary)", fontSize: 12, marginTop: 4 }}>
                          {server.transport.type === "stdio" ? server.transport.command : server.transport.url}
                        </div>
                        <div style={{ color: "var(--text-secondary)", fontSize: 12, marginTop: 6 }}>
                          {server.status} · {server.toolCount} tools
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div style={{ display: "grid", gap: 16 }}>
                {renderMcpEditor()}
              </div>
            </div>

            <div>
              <div style={sectionTitleStyle}>Permissions</div>
              <div style={bodyTextStyle}>Configure the default tool approval policy.</div>
            </div>

            <label style={{ ...labelStyle, display: "flex", alignItems: "center", gap: 10 }}>
              <input
                type="checkbox"
                checked={permissionConfig.fullAccess}
                onChange={(event) => setPermissionConfig((current) => ({
                  ...current,
                  fullAccess: event.target.checked,
                }))}
              />
              Full access (keeps subagent on confirm)
            </label>

            <div style={{ display: "grid", gap: 12 }}>
              {PERMISSION_TOOLS.map((toolName) => {
                const level = getDisplayedPermissionLevel(toolName, permissionConfig.toolDefaults[toolName]);
                return (
                  <div
                    key={toolName}
                    style={{
                      display: "grid",
                      gap: 8,
                      padding: 14,
                      borderRadius: 14,
                      border: "1px solid var(--border)",
                      background: "var(--bg-secondary)",
                    }}
                  >
                    <div style={{ fontWeight: 600 }}>{toolName}</div>
                    <select
                      value={level}
                      onChange={(event) => {
                        const nextLevel = event.target.value as PermissionLevel;
                        setPermissionConfig((current) => ({
                          ...current,
                          toolDefaults: {
                            ...current.toolDefaults,
                            [toolName]: nextLevel,
                          },
                          denyReasons: nextLevel === "deny"
                            ? current.denyReasons
                            : Object.fromEntries(
                              Object.entries(current.denyReasons).filter(([name]) => name !== toolName),
                            ),
                        }));
                      }}
                      style={inputStyle}
                    >
                      <option value="allow">Allow</option>
                      <option value="confirm">Confirm</option>
                      <option value="deny">Deny</option>
                    </select>
                    {level === "deny" ? (
                      <input
                        value={permissionConfig.denyReasons[toolName] ?? ""}
                        onChange={(event) => setPermissionConfig((current) => ({
                          ...current,
                          denyReasons: {
                            ...current.denyReasons,
                            [toolName]: event.target.value,
                          },
                        }))}
                        placeholder="Optional deny reason"
                        style={inputStyle}
                      />
                    ) : null}
                  </div>
                );
              })}
            </div>

            <div style={actionsRowStyle}>
              <button
                style={primaryButtonStyle}
                onClick={() => void handleSavePermissions()}
                disabled={!canSavePermissions(savingPermissions, permissionsLoadError)}
              >
                {savingPermissions ? "Saving…" : "Save Permissions"}
              </button>
            </div>
          </div>

          {status ? (
            <div
              style={{
                marginTop: 18,
                padding: "12px 14px",
                borderRadius: 12,
                background: statusTone === "success" ? "var(--success-bg)" : "var(--danger-bg)",
                color: statusTone === "success" ? "var(--success)" : "var(--danger)",
              }}
            >
              {status}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function ProviderForm({
  draft,
  onChange,
  apiKeyLabel,
}: {
  draft: ProviderDraft;
  onChange: (draft: ProviderDraft) => void;
  apiKeyLabel: string;
}) {
  return (
    <div style={{ display: "grid", gap: 14 }}>
      <label style={labelStyle}>
        Display name
        <input
          value={draft.displayName}
          onChange={(event) => onChange({ ...draft, displayName: event.target.value })}
          style={inputStyle}
        />
      </label>
      <label style={labelStyle}>
        Base URL
        <input
          value={draft.baseUrl}
          onChange={(event) => onChange({ ...draft, baseUrl: event.target.value })}
          style={inputStyle}
        />
      </label>
      <label style={labelStyle}>
        Model
        <input
          value={draft.modelId}
          onChange={(event) => onChange({ ...draft, modelId: event.target.value })}
          style={inputStyle}
        />
      </label>
      <label style={labelStyle}>
        {apiKeyLabel}
        <input
          type="password"
          value={draft.apiKey}
          onChange={(event) => onChange({ ...draft, apiKey: event.target.value })}
          placeholder="Leave blank to keep current key"
          style={inputStyle}
        />
      </label>
    </div>
  );
}

function McpServerForm({
  draft,
  onChange,
}: {
  draft: McpDraft;
  onChange: (draft: McpDraft) => void;
}) {
  return (
    <div style={{ display: "grid", gap: 14 }}>
      <label style={labelStyle}>
        Server name
        <input
          value={draft.name}
          onChange={(event) => onChange({ ...draft, name: event.target.value })}
          style={inputStyle}
        />
      </label>

      <label style={labelStyle}>
        Transport
        <select
          value={draft.transportType}
          onChange={(event) => onChange({
            ...draft,
            transportType: event.target.value as McpDraft["transportType"],
          })}
          style={inputStyle}
        >
          <option value="stdio">stdio</option>
          <option value="streamable-http">Streamable HTTP</option>
        </select>
      </label>

      <label style={{ ...labelStyle, display: "flex", alignItems: "center", gap: 10 }}>
        <input
          type="checkbox"
          checked={draft.enabled}
          onChange={(event) => onChange({ ...draft, enabled: event.target.checked })}
        />
        Enabled
      </label>

      <label style={{ ...labelStyle, display: "flex", alignItems: "center", gap: 10 }}>
        <input
          type="checkbox"
          checked={draft.autoStart}
          onChange={(event) => onChange({ ...draft, autoStart: event.target.checked })}
        />
        Auto-start
      </label>

      {draft.transportType === "stdio" ? (
        <>
          <label style={labelStyle}>
            Command
            <input
              value={draft.command}
              onChange={(event) => onChange({ ...draft, command: event.target.value })}
              style={inputStyle}
            />
          </label>
          <label style={labelStyle}>
            Args
            <textarea
              value={draft.argsText}
              onChange={(event) => onChange({ ...draft, argsText: event.target.value })}
              placeholder="One argument per line"
              style={textareaStyle}
            />
          </label>
          <label style={labelStyle}>
            Working directory
            <input
              value={draft.cwd}
              onChange={(event) => onChange({ ...draft, cwd: event.target.value })}
              style={inputStyle}
            />
          </label>
          <label style={labelStyle}>
            Environment JSON
            <textarea
              value={draft.envText}
              onChange={(event) => onChange({ ...draft, envText: event.target.value })}
              placeholder='{"API_KEY":"..."}'
              style={textareaStyle}
            />
          </label>
        </>
      ) : (
        <>
          <label style={labelStyle}>
            URL
            <input
              value={draft.url}
              onChange={(event) => onChange({ ...draft, url: event.target.value })}
              style={inputStyle}
            />
          </label>
          <label style={labelStyle}>
            Headers JSON
            <textarea
              value={draft.headersText}
              onChange={(event) => onChange({ ...draft, headersText: event.target.value })}
              placeholder='{"Authorization":"Bearer ..."}'
              style={textareaStyle}
            />
          </label>
        </>
      )}
    </div>
  );
}

const headerStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 16,
  padding: "16px 20px",
  borderBottom: "1px solid var(--border)",
  background: "var(--bg-elevated)",
};

const sidebarStyle: CSSProperties = {
  padding: 16,
  borderRight: "1px solid var(--border)",
  background: "var(--bg-secondary)",
  overflowY: "auto",
};

const detailPaneStyle: CSSProperties = {
  padding: 24,
  overflowY: "auto",
};

const sectionTitleStyle: CSSProperties = {
  fontSize: 22,
  fontWeight: 700,
  marginBottom: 6,
};

const bodyTextStyle: CSSProperties = {
  color: "var(--text-secondary)",
  lineHeight: 1.6,
};

const labelStyle: CSSProperties = {
  display: "grid",
  gap: 6,
  color: "var(--text-secondary)",
  fontSize: 13,
};

const inputStyle: CSSProperties = {
  width: "100%",
  padding: "11px 12px",
  borderRadius: 12,
  border: "1px solid var(--border)",
  background: "var(--bg-primary)",
  color: "var(--text-primary)",
};

const textareaStyle: CSSProperties = {
  ...inputStyle,
  minHeight: 96,
  resize: "vertical",
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
};

const actionsRowStyle: CSSProperties = {
  display: "flex",
  gap: 10,
  justifyContent: "flex-end",
  flexWrap: "wrap",
};

const primaryButtonStyle: CSSProperties = {
  padding: "11px 16px",
  borderRadius: 12,
  border: "none",
  background: "var(--accent)",
  color: "#fff",
  cursor: "pointer",
};

const secondaryButtonStyle: CSSProperties = {
  padding: "11px 16px",
  borderRadius: 12,
  border: "1px solid var(--border)",
  background: "var(--bg-primary)",
  color: "var(--text-primary)",
  cursor: "pointer",
};

const listButtonStyle: CSSProperties = {
  width: "100%",
  textAlign: "left",
  padding: 14,
  borderRadius: 14,
  border: "1px solid var(--border)",
  background: "var(--bg-primary)",
  color: "var(--text-primary)",
  cursor: "pointer",
};
