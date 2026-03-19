import { useState, useCallback } from "react";
import type { SessionSummary } from "@shared/types";
import { ChatView } from "./components/ChatView";
import { ProviderSetup } from "./components/ProviderSetup";
import { useSessionList } from "./hooks/useSession";

export function App() {
  const { sessions, refresh } = useSessionList();
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [providerReady, setProviderReady] = useState(false);
  const [providerId, setProviderId] = useState<string | null>(null);
  const [modelId, setModelId] = useState<string | null>(null);

  const handleProviderDone = useCallback(
    (pid: string, mid: string) => {
      setProviderId(pid);
      setModelId(mid);
      setProviderReady(true);
    },
    [],
  );

  const handleNewSession = useCallback(async () => {
    if (!providerId || !modelId) return;
    const { sessionId } = await window.scorel.sessions.create({
      providerId,
      modelId,
      workspaceRoot: "~",
    });
    await refresh();
    setActiveSessionId(sessionId);
  }, [providerId, modelId, refresh]);

  if (!providerReady) {
    return <ProviderSetup onDone={handleProviderDone} />;
  }

  return (
    <div style={{ display: "flex", height: "100vh", fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif" }}>
      {/* Sidebar */}
      <div
        style={{
          width: 240,
          borderRight: "1px solid #e0e0e0",
          display: "flex",
          flexDirection: "column",
          background: "#f5f5f5",
        }}
      >
        <div style={{ padding: "12px 16px", borderBottom: "1px solid #e0e0e0" }}>
          <button
            onClick={handleNewSession}
            style={{
              width: "100%",
              padding: "8px 0",
              borderRadius: 8,
              border: "none",
              background: "#007aff",
              color: "#fff",
              fontSize: 14,
              cursor: "pointer",
            }}
          >
            New Chat
          </button>
        </div>
        <div style={{ flex: 1, overflowY: "auto" }}>
          {sessions.map((s: SessionSummary) => (
            <div
              key={s.id}
              onClick={() => setActiveSessionId(s.id)}
              style={{
                padding: "10px 16px",
                cursor: "pointer",
                background: s.id === activeSessionId ? "#e0e0e0" : "transparent",
                fontSize: 13,
                borderBottom: "1px solid #eee",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {s.title ?? "Untitled"}
            </div>
          ))}
        </div>
      </div>

      {/* Main area */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
        {activeSessionId ? (
          <ChatView sessionId={activeSessionId} />
        ) : (
          <div
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#999",
              fontSize: 16,
            }}
          >
            Select or create a chat to get started
          </div>
        )}
      </div>
    </div>
  );
}
