import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import type { ProviderConfig } from "@shared/types";
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

  const selectedProvider = useMemo(
    () => providers.find((provider) => provider.id === selectedProviderId) ?? null,
    [providers, selectedProviderId],
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
