import { useState, useCallback } from "react";
import type { ProviderConfig, Api } from "@shared/types";

export function ProviderSetup({
  onDone,
}: {
  onDone: (providerId: string, modelId: string) => void;
}) {
  const [displayName, setDisplayName] = useState("OpenAI");
  const [baseUrl, setBaseUrl] = useState("https://api.openai.com/v1");
  const [modelId, setModelId] = useState("gpt-4o");
  const [apiKey, setApiKey] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const handleSave = useCallback(async () => {
    if (!apiKey.trim() || !baseUrl.trim() || !modelId.trim()) return;
    setSaving(true);
    setStatus(null);

    const providerId = displayName.toLowerCase().replace(/\s+/g, "-");
    const config: ProviderConfig = {
      id: providerId,
      displayName,
      api: "openai-chat-completions" as Api,
      baseUrl: baseUrl.replace(/\/$/, ""),
      auth: { type: "bearer", keyRef: providerId },
      models: [{ id: modelId, displayName: modelId }],
    };

    try {
      await window.scorel.providers.upsert(config);
      await window.scorel.secrets.store(providerId, apiKey.trim());
      setApiKey("");
      setStatus("Saved");
      onDone(providerId, modelId);
    } catch (err: unknown) {
      setStatus(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }, [displayName, baseUrl, modelId, apiKey, onDone]);

  return (
    <div
      style={{
        maxWidth: 420,
        margin: "40px auto",
        padding: 24,
        background: "#fff",
        borderRadius: 12,
        boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
      }}
    >
      <h2 style={{ margin: "0 0 16px", fontSize: 18 }}>Configure Provider</h2>
      <label style={labelStyle}>
        Display Name
        <input
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          style={inputStyle}
        />
      </label>
      <label style={labelStyle}>
        Base URL
        <input
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          style={inputStyle}
        />
      </label>
      <label style={labelStyle}>
        Model
        <input
          value={modelId}
          onChange={(e) => setModelId(e.target.value)}
          style={inputStyle}
        />
      </label>
      <label style={labelStyle}>
        API Key
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="sk-..."
          style={inputStyle}
        />
      </label>
      <button
        onClick={handleSave}
        disabled={saving || !apiKey.trim()}
        style={{
          width: "100%",
          padding: "10px 0",
          borderRadius: 8,
          border: "none",
          background: saving || !apiKey.trim() ? "#ccc" : "#007aff",
          color: "#fff",
          fontSize: 14,
          cursor: saving || !apiKey.trim() ? "default" : "pointer",
          marginTop: 8,
        }}
      >
        {saving ? "Saving..." : "Save & Continue"}
      </button>
      {status && (
        <p style={{ marginTop: 8, fontSize: 13, color: status === "Saved" ? "#34c759" : "#ff3b30" }}>
          {status}
        </p>
      )}
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  display: "block",
  marginBottom: 12,
  fontSize: 13,
  color: "#555",
};

const inputStyle: React.CSSProperties = {
  display: "block",
  width: "100%",
  marginTop: 4,
  padding: "8px 10px",
  border: "1px solid #ccc",
  borderRadius: 6,
  fontSize: 14,
  boxSizing: "border-box",
};
