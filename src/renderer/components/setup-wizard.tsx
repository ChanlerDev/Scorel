import { useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  buildProviderConfig,
  getProviderPreset,
  type ProviderDraft,
  type WizardProviderType,
} from "./setup-wizard-model";
import { validateProviderDraft } from "./setup-wizard-model";

type WizardStep =
  | "welcome"
  | "select-provider"
  | "configure"
  | "test-connection"
  | "select-workspace"
  | "done";

type SavedProvider = {
  providerId: string;
  modelId: string;
  displayName: string;
};

const stepOrder: WizardStep[] = [
  "welcome",
  "select-provider",
  "configure",
  "test-connection",
  "select-workspace",
  "done",
];

function createDraft(providerType: WizardProviderType): ProviderDraft {
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

function stepLabel(step: WizardStep): string {
  switch (step) {
    case "welcome":
      return "Welcome";
    case "select-provider":
      return "Provider";
    case "configure":
      return "Configure";
    case "test-connection":
      return "Connection";
    case "select-workspace":
      return "Workspace";
    case "done":
      return "Done";
  }
}

export function SetupWizard({
  onDone,
}: {
  onDone: (result: { providerId: string; modelId: string; sessionId: string }) => void;
}) {
  const [step, setStep] = useState<WizardStep>("welcome");
  const [version, setVersion] = useState<string>("");
  const [providerType, setProviderType] = useState<WizardProviderType>("openai");
  const [draft, setDraft] = useState<ProviderDraft>(() => createDraft("openai"));
  const [savedProvider, setSavedProvider] = useState<SavedProvider | null>(null);
  const [workspaceRoot, setWorkspaceRoot] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  const preset = useMemo(() => getProviderPreset(providerType), [providerType]);
  const currentStepIndex = stepOrder.indexOf(step);

  useEffect(() => {
    window.scorel.app.getVersion().then(setVersion).catch(() => setVersion(""));
  }, []);

  const handleProviderSelect = (nextProviderType: WizardProviderType) => {
    setProviderType(nextProviderType);
    setDraft(createDraft(nextProviderType));
    setStatus(null);
  };

  const handleTestConnection = async () => {
    const validationErrors = validateProviderDraft(draft);
    if (validationErrors.length > 0) {
      setStatus(validationErrors[0] ?? "Provider configuration is incomplete");
      return;
    }

    setIsBusy(true);
    setStatus(null);

    try {
      const config = buildProviderConfig({
        providerType,
        displayName: draft.displayName,
        baseUrl: draft.baseUrl,
        modelId: draft.modelId,
      });

      await window.scorel.providers.upsert(config);
      await window.scorel.secrets.store(config.id, draft.apiKey.trim());

      const result = await window.scorel.providers.testConnection(config.id);
      if (!result.ok) {
        setStatus(result.error ?? "Connection test failed");
        return;
      }

      setSavedProvider({
        providerId: config.id,
        modelId: draft.modelId.trim(),
        displayName: config.displayName,
      });
      setStatus("Connection succeeded");
      setStep("select-workspace");
    } catch (error: unknown) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setIsBusy(false);
    }
  };

  const handleSelectWorkspace = async () => {
    setStatus(null);
    const selected = await window.scorel.app.selectDirectory();
    if (selected) {
      setWorkspaceRoot(selected);
    }
  };

  const handleFinish = async () => {
    if (!savedProvider || !workspaceRoot) {
      return;
    }

    setIsBusy(true);
    setStatus(null);

    try {
      const { sessionId } = await window.scorel.sessions.create({
        providerId: savedProvider.providerId,
        modelId: savedProvider.modelId,
        workspaceRoot,
      });
      onDone({
        providerId: savedProvider.providerId,
        modelId: savedProvider.modelId,
        sessionId,
      });
    } catch (error: unknown) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setIsBusy(false);
    }
  };

  const renderStep = () => {
    switch (step) {
      case "welcome":
        return (
          <>
            <div style={{ fontSize: 28, fontWeight: 700, marginBottom: 12 }}>Welcome to Scorel</div>
            <div style={bodyTextStyle}>
              Set up a provider, verify the connection, choose a workspace, and start your first local coding session.
            </div>
            <button style={primaryButtonStyle} onClick={() => setStep("select-provider")}>
              Get Started
            </button>
          </>
        );

      case "select-provider":
        return (
          <>
            <div style={sectionTitleStyle}>Choose a provider</div>
            <div style={{ display: "grid", gap: 12, marginBottom: 20 }}>
              {(["openai", "anthropic", "custom"] as WizardProviderType[]).map((option) => {
                const optionPreset = getProviderPreset(option)!;
                const selected = option === providerType;

                return (
                  <button
                    key={option}
                    onClick={() => handleProviderSelect(option)}
                    style={{
                      ...cardButtonStyle,
                      borderColor: selected ? "var(--accent)" : "var(--border)",
                      background: selected ? "var(--bg-tertiary)" : "var(--bg-primary)",
                    }}
                  >
                    <div style={{ fontSize: 16, fontWeight: 600 }}>{optionPreset.displayName}</div>
                    <div style={{ ...bodyTextStyle, marginTop: 4 }}>
                      {option === "custom" ? "OpenAI-compatible endpoint" : `${optionPreset.displayName} hosted API`}
                    </div>
                  </button>
                );
              })}
            </div>
            <div style={footerActionsStyle}>
              <button style={secondaryButtonStyle} onClick={() => setStep("welcome")}>Back</button>
              <button style={primaryButtonStyle} onClick={() => setStep("configure")}>Continue</button>
            </div>
          </>
        );

      case "configure":
        return (
          <>
            <div style={sectionTitleStyle}>Configure {preset?.displayName ?? "provider"}</div>
            <div style={{ display: "grid", gap: 14 }}>
              <label style={labelStyle}>
                Display name
                <input
                  value={draft.displayName}
                  onChange={(event) => setDraft((current) => ({ ...current, displayName: event.target.value }))}
                  style={inputStyle}
                />
              </label>
              <label style={labelStyle}>
                Base URL
                <input
                  value={draft.baseUrl}
                  onChange={(event) => setDraft((current) => ({ ...current, baseUrl: event.target.value }))}
                  disabled={!preset?.allowsCustomBaseUrl}
                  style={{
                    ...inputStyle,
                    opacity: preset?.allowsCustomBaseUrl ? 1 : 0.7,
                  }}
                />
              </label>
              <label style={labelStyle}>
                Model
                <input
                  value={draft.modelId}
                  onChange={(event) => setDraft((current) => ({ ...current, modelId: event.target.value }))}
                  style={inputStyle}
                />
              </label>
              <label style={labelStyle}>
                API key
                <input
                  type="password"
                  value={draft.apiKey}
                  onChange={(event) => setDraft((current) => ({ ...current, apiKey: event.target.value }))}
                  placeholder={preset?.placeholder}
                  style={inputStyle}
                />
              </label>
            </div>
            <div style={footerActionsStyle}>
              <button style={secondaryButtonStyle} onClick={() => setStep("select-provider")}>Back</button>
              <button style={primaryButtonStyle} onClick={() => setStep("test-connection")}>Continue</button>
            </div>
          </>
        );

      case "test-connection":
        return (
          <>
            <div style={sectionTitleStyle}>Test your connection</div>
            <div style={bodyTextStyle}>
              Scorel will save the provider config securely, store the API key in Keychain, and verify the endpoint before continuing.
            </div>
            <div style={{ marginTop: 20, display: "flex", gap: 12, alignItems: "center" }}>
              <button style={primaryButtonStyle} onClick={handleTestConnection} disabled={isBusy}>
                {isBusy ? "Testing…" : "Test Connection"}
              </button>
              {isBusy ? <SpinnerLabel label="Testing provider" /> : null}
            </div>
            <div style={footerActionsStyle}>
              <button style={secondaryButtonStyle} onClick={() => setStep("configure")} disabled={isBusy}>Back</button>
            </div>
          </>
        );

      case "select-workspace":
        return (
          <>
            <div style={sectionTitleStyle}>Choose a workspace</div>
            <div style={bodyTextStyle}>
              Scorel only reads and writes inside the folder you pick for this session.
            </div>
            <div
              style={{
                marginTop: 16,
                padding: 14,
                borderRadius: 12,
                border: "1px solid var(--border)",
                background: "var(--bg-secondary)",
                color: workspaceRoot ? "var(--text-primary)" : "var(--text-muted)",
                wordBreak: "break-all",
              }}
            >
              {workspaceRoot ?? "No folder selected yet"}
            </div>
            <div style={{ marginTop: 16, display: "flex", gap: 12, alignItems: "center" }}>
              <button style={primaryButtonStyle} onClick={() => void handleSelectWorkspace()}>
                {workspaceRoot ? "Choose Another Folder" : "Select Folder"}
              </button>
            </div>
            <div style={footerActionsStyle}>
              <button style={secondaryButtonStyle} onClick={() => setStep("test-connection")}>Back</button>
              <button
                style={primaryButtonStyle}
                disabled={!workspaceRoot}
                onClick={() => setStep("done")}
              >
                Continue
              </button>
            </div>
          </>
        );

      case "done":
        return (
          <>
            <div style={sectionTitleStyle}>Everything is ready</div>
            <div style={{ display: "grid", gap: 10, marginTop: 14 }}>
              <SummaryRow label="Provider" value={savedProvider?.displayName ?? "-"} />
              <SummaryRow label="Model" value={savedProvider?.modelId ?? "-"} />
              <SummaryRow label="Workspace" value={workspaceRoot ?? "-"} />
            </div>
            <div style={footerActionsStyle}>
              <button style={secondaryButtonStyle} onClick={() => setStep("select-workspace")} disabled={isBusy}>Back</button>
              <button style={primaryButtonStyle} onClick={() => void handleFinish()} disabled={isBusy}>
                {isBusy ? "Starting…" : "Start Chatting"}
              </button>
            </div>
          </>
        );
    }
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 32,
        background: "var(--bg-secondary)",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 720,
          padding: 28,
          borderRadius: 24,
          border: "1px solid var(--border)",
          background: "var(--bg-primary)",
          boxShadow: "0 20px 50px var(--shadow)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <div>
            <div style={{ fontSize: 14, color: "var(--text-secondary)", marginBottom: 4 }}>Scorel Setup</div>
            <div style={{ fontSize: 20, fontWeight: 700 }}>{stepLabel(step)}</div>
          </div>
          {version ? <div style={{ color: "var(--text-muted)", fontSize: 12 }}>v{version}</div> : null}
        </div>

        <div style={{ display: "flex", gap: 8, marginBottom: 24 }}>
          {stepOrder.map((item, index) => (
            <div
              key={item}
              style={{
                flex: 1,
                height: 6,
                borderRadius: 999,
                background: index <= currentStepIndex ? "var(--accent)" : "var(--bg-tertiary)",
                opacity: index <= currentStepIndex ? 1 : 0.6,
              }}
            />
          ))}
        </div>

        {renderStep()}

        {status ? (
          <div
            style={{
              marginTop: 18,
              padding: "12px 14px",
              borderRadius: 12,
              background: status === "Connection succeeded" ? "var(--success-bg)" : "var(--danger-bg)",
              color: status === "Connection succeeded" ? "var(--success)" : "var(--danger)",
            }}
          >
            {status}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function SpinnerLabel({ label }: { label: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--text-secondary)" }}>
      <span
        style={{
          width: 14,
          height: 14,
          borderRadius: "50%",
          border: "2px solid var(--border)",
          borderTopColor: "var(--accent)",
          animation: "scorel-spin 0.8s linear infinite",
        }}
      />
      {label}
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "120px 1fr",
        gap: 12,
        padding: "10px 0",
        borderBottom: "1px solid var(--border)",
      }}
    >
      <div style={{ color: "var(--text-secondary)" }}>{label}</div>
      <div style={{ wordBreak: "break-word" }}>{value}</div>
    </div>
  );
}

const sectionTitleStyle: CSSProperties = {
  fontSize: 22,
  fontWeight: 700,
  marginBottom: 10,
};

const bodyTextStyle: CSSProperties = {
  color: "var(--text-secondary)",
  lineHeight: 1.6,
};

const footerActionsStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 12,
  marginTop: 24,
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

const cardButtonStyle: CSSProperties = {
  width: "100%",
  textAlign: "left",
  padding: 16,
  borderRadius: 14,
  border: "1px solid var(--border)",
  color: "var(--text-primary)",
  cursor: "pointer",
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
