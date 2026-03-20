import { Fragment, useCallback, useEffect, useState } from "react";
import type { SearchResult, SessionSummary } from "@shared/types";
import { ChatView } from "./components/ChatView";
import { ProviderSetup } from "./components/ProviderSetup";
import { useSessionList } from "./hooks/useSession";

function renderSnippet(snippet: string) {
  return snippet
    .split(/(<mark>.*?<\/mark>)/g)
    .filter(Boolean)
    .map((part, index) => {
      if (part.startsWith("<mark>") && part.endsWith("</mark>")) {
        return (
          <mark key={`${part}-${index}`}>
            {part.slice("<mark>".length, -"</mark>".length)}
          </mark>
        );
      }

      return <Fragment key={`${part}-${index}`}>{part}</Fragment>;
    });
}

export function App() {
  const [showArchived, setShowArchived] = useState(false);
  const { sessions, refresh } = useSessionList({ archived: showArchived });
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [providerReady, setProviderReady] = useState(false);
  const [providerId, setProviderId] = useState<string | null>(null);
  const [modelId, setModelId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);

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

  useEffect(() => {
    const normalizedQuery = searchQuery.trim();
    if (normalizedQuery.length === 0) {
      setSearchResults([]);
      setSearchLoading(false);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        setSearchLoading(true);
        const results = await window.scorel.search.query(normalizedQuery, { limit: 50 });
        if (!cancelled) {
          setSearchResults(results);
        }
      } finally {
        if (!cancelled) {
          setSearchLoading(false);
        }
      }
    }, 150);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [searchQuery]);

  const handleSessionMutated = useCallback(async (action: "archive" | "unarchive" | "delete") => {
    await refresh();
    if (action === "delete" || action === "archive") {
      setActiveSessionId(null);
      return;
    }

    setShowArchived(false);
  }, [refresh]);

  const isSearching = searchQuery.trim().length > 0;

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
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button
              onClick={() => setShowArchived(false)}
              style={{
                flex: 1,
                padding: "6px 0",
                borderRadius: 8,
                border: "1px solid #d0d0d0",
                background: showArchived ? "#fff" : "#e0e0e0",
                cursor: "pointer",
              }}
            >
              Active
            </button>
            <button
              onClick={() => setShowArchived(true)}
              style={{
                flex: 1,
                padding: "6px 0",
                borderRadius: 8,
                border: "1px solid #d0d0d0",
                background: showArchived ? "#e0e0e0" : "#fff",
                cursor: "pointer",
              }}
            >
              Archived
            </button>
          </div>
          <input
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search history"
            style={{
              width: "100%",
              marginTop: 10,
              padding: "8px 10px",
              borderRadius: 8,
              border: "1px solid #d0d0d0",
              boxSizing: "border-box",
            }}
          />
        </div>
        <div style={{ flex: 1, overflowY: "auto" }}>
          {isSearching ? (
            <>
              {searchLoading && (
                <div style={{ padding: "12px 16px", fontSize: 12, color: "#666" }}>
                  Searching…
                </div>
              )}
              {!searchLoading && searchResults.length === 0 && (
                <div style={{ padding: "12px 16px", fontSize: 12, color: "#666" }}>
                  No matches
                </div>
              )}
              {searchResults.map((result) => (
                <div
                  key={`${result.messageId}-${result.seq}`}
                  onClick={() => setActiveSessionId(result.sessionId)}
                  style={{
                    padding: "10px 16px",
                    cursor: "pointer",
                    background: result.sessionId === activeSessionId ? "#e0e0e0" : "transparent",
                    fontSize: 12,
                    borderBottom: "1px solid #eee",
                  }}
                >
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
                    {result.sessionTitle ?? "Untitled"}
                  </div>
                  <div style={{ color: "#666", lineHeight: 1.4 }}>{renderSnippet(result.snippet)}</div>
                </div>
              ))}
            </>
          ) : (
            <>
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
              {sessions.length === 0 && (
                <div style={{ padding: "12px 16px", fontSize: 12, color: "#666" }}>
                  {showArchived ? "No archived sessions" : "No sessions yet"}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Main area */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
        {activeSessionId ? (
          <ChatView sessionId={activeSessionId} onSessionMutated={handleSessionMutated} />
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
