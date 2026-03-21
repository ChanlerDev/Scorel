import React, { useEffect, type CSSProperties } from "react";
import type { WorkspaceEntry } from "@shared/types";

type WorkspacePickerProps = {
  defaultWorkspace: string;
  workspaces: WorkspaceEntry[];
  loading: boolean;
  creating: boolean;
  error: string | null;
  onUseWorkspace: (workspacePath: string) => void;
  onBrowse: () => void;
  onClose: () => void;
};

function formatWorkspaceLabel(workspacePath: string): string {
  const homePath = /^\/Users\/[^/]+/;
  return workspacePath.replace(homePath, "~");
}

export function shouldCloseWorkspacePickerOnKey(key: string, creating: boolean): boolean {
  return key === "Escape" && !creating;
}

export function WorkspacePicker({
  defaultWorkspace,
  workspaces,
  loading,
  creating,
  error,
  onUseWorkspace,
  onBrowse,
  onClose,
}: WorkspacePickerProps) {
  const recentWorkspaces = workspaces.filter((workspace) => workspace.path !== defaultWorkspace);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (shouldCloseWorkspacePickerOnKey(event.key, creating)) {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [creating, onClose]);

  return (
    <div style={overlayStyle}>
      <div style={panelStyle}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <div>
            <div style={{ fontSize: 22, fontWeight: 700 }}>Select Workspace</div>
            <div style={{ color: "var(--text-secondary)", marginTop: 4 }}>
              Start a chat in the default workspace, a recent project, or browse for another folder.
            </div>
          </div>
          <button style={secondaryButtonStyle} onClick={onClose} disabled={creating}>Cancel</button>
        </div>

        <div style={{ marginTop: 20, display: "grid", gap: 12 }}>
          <WorkspaceRow
            label="Default workspace"
            workspacePath={defaultWorkspace}
            exists
            creating={creating}
            onUse={onUseWorkspace}
          />

          {loading ? (
            <div style={{ color: "var(--text-secondary)" }}>Loading workspaces…</div>
          ) : recentWorkspaces.length > 0 ? (
            <div style={{ display: "grid", gap: 10 }}>
              <div style={{ color: "var(--text-secondary)", fontSize: 13, fontWeight: 600 }}>Recent workspaces</div>
              {recentWorkspaces.map((workspace) => (
                <WorkspaceRow
                  key={workspace.path}
                  label={workspace.label ?? formatWorkspaceLabel(workspace.path)}
                  workspacePath={workspace.path}
                  exists={workspace.exists}
                  creating={creating}
                  onUse={onUseWorkspace}
                />
              ))}
            </div>
          ) : (
            <div style={{ color: "var(--text-secondary)" }}>No recent workspaces yet.</div>
          )}
        </div>

        {error ? (
          <div style={errorStyle}>{error}</div>
        ) : null}

        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 20 }}>
          <button style={primaryButtonStyle} onClick={onBrowse} disabled={creating}>
            {creating ? "Creating…" : "Browse…"}
          </button>
        </div>
      </div>
    </div>
  );
}

function WorkspaceRow({
  label,
  workspacePath,
  exists,
  creating,
  onUse,
}: {
  label: string;
  workspacePath: string;
  exists: boolean;
  creating: boolean;
  onUse: (workspacePath: string) => void;
}) {
  return (
    <div
      style={{
        padding: 14,
        borderRadius: 14,
        border: "1px solid var(--border)",
        background: exists ? "var(--bg-primary)" : "var(--bg-secondary)",
        opacity: exists ? 1 : 0.7,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 4 }}>{label}</div>
        <div style={{ wordBreak: "break-all" }}>{formatWorkspaceLabel(workspacePath)}</div>
        {!exists ? (
          <div style={{ color: "var(--text-secondary)", fontSize: 12, marginTop: 6 }}>
            Folder no longer exists on disk.
          </div>
        ) : null}
      </div>

      <button
        style={secondaryButtonStyle}
        disabled={!exists || creating}
        onClick={() => onUse(workspacePath)}
      >
        Use
      </button>
    </div>
  );
}

const overlayStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(15, 23, 42, 0.28)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 24,
  zIndex: 1000,
};

const panelStyle: CSSProperties = {
  width: "100%",
  maxWidth: 720,
  padding: 24,
  borderRadius: 20,
  border: "1px solid var(--border)",
  background: "var(--bg-primary)",
  boxShadow: "0 24px 64px var(--shadow)",
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
  flexShrink: 0,
};

const errorStyle: CSSProperties = {
  marginTop: 18,
  padding: "12px 14px",
  borderRadius: 12,
  background: "var(--danger-bg)",
  color: "var(--danger)",
};
