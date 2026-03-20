import { Fragment, useCallback, useEffect, useState } from "react";
import type { SearchResult, SessionSummary } from "@shared/types";
import { ChatView } from "./components/ChatView";
import { SetupWizard } from "./components/setup-wizard";
import { ErrorBoundary } from "./components/error-boundary";
import { useSessionList } from "./hooks/useSession";
import { useTheme } from "./hooks/use-theme";
import type { SearchNavigationTarget } from "./message-navigation";

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
  useTheme();

  const [showArchived, setShowArchived] = useState(false);
  const { sessions, loading: sessionsLoading, refresh } = useSessionList({ archived: showArchived });
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [appState, setAppState] = useState<"loading" | "setup" | "ready">("loading");
  const [providerId, setProviderId] = useState<string | null>(null);
  const [modelId, setModelId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchNavigationTarget, setSearchNavigationTarget] = useState<SearchNavigationTarget | null>(null);

  const handleProviderDone = useCallback(
    async (result: { providerId: string; modelId: string; sessionId: string }) => {
      setProviderId(result.providerId);
      setModelId(result.modelId);
      setActiveSessionId(result.sessionId);
      setAppState("ready");
      await refresh();
    },
    [refresh],
  );

  const handleNewSession = useCallback(async () => {
    if (!providerId || !modelId) return;
    const workspaceRoot = await window.scorel.app.selectDirectory();
    if (!workspaceRoot) {
      return;
    }

    const { sessionId } = await window.scorel.sessions.create({
      providerId,
      modelId,
      workspaceRoot,
    });
    await refresh();
    setActiveSessionId(sessionId);
  }, [providerId, modelId, refresh]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const providers = await window.scorel.providers.list();
      if (cancelled) {
        return;
      }

      if (providers.length === 0) {
        setAppState("setup");
        return;
      }

      const activeProvider = providers[0] ?? null;
      const activeModel = activeProvider?.models[0] ?? null;

      if (!activeProvider || !activeModel) {
        setAppState("setup");
        return;
      }

      setProviderId(activeProvider.id);
      setModelId(activeModel.id);
      setAppState("ready");
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (appState !== "ready" || activeSessionId || sessions.length === 0) {
      return;
    }

    setActiveSessionId(sessions[0]?.id ?? null);
  }, [appState, activeSessionId, sessions]);

  useEffect(() => {
    return window.scorel.menu.onNewSession(() => {
      void handleNewSession();
    });
  }, [handleNewSession]);

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

  if (appState === "loading") {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "var(--bg-primary)",
          color: "var(--text-secondary)",
        }}
      >
        Loading Scorel…
      </div>
    );
  }

  if (appState === "setup") {
    return <SetupWizard onDone={handleProviderDone} />;
  }

  return (
    <div style={{ display: "flex", height: "100vh", background: "var(--bg-primary)", color: "var(--text-primary)" }}>
      {/* Sidebar */}
      <ErrorBoundary region="Sidebar">
        <div
          style={{
            width: 260,
            borderRight: "1px solid var(--border)",
            display: "flex",
            flexDirection: "column",
            background: "var(--bg-secondary)",
          }}
        >
          <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)" }}>
            <button
              onClick={() => void handleNewSession()}
              style={{
                width: "100%",
                padding: "8px 0",
                borderRadius: 10,
                border: "none",
                background: "var(--accent)",
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
                  border: "1px solid var(--border)",
                  background: showArchived ? "var(--bg-primary)" : "var(--bg-tertiary)",
                  color: "var(--text-primary)",
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
                  border: "1px solid var(--border)",
                  background: showArchived ? "var(--bg-tertiary)" : "var(--bg-primary)",
                  color: "var(--text-primary)",
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
                border: "1px solid var(--border)",
                background: "var(--bg-primary)",
                color: "var(--text-primary)",
              }}
            />
          </div>
          <div style={{ flex: 1, overflowY: "auto" }}>
            {isSearching ? (
              <>
                {searchLoading && (
                  <div style={{ padding: "12px 16px", fontSize: 12, color: "var(--text-secondary)" }}>
                    Searching…
                  </div>
                )}
                {!searchLoading && searchResults.length === 0 && (
                  <div style={{ padding: "12px 16px", fontSize: 12, color: "var(--text-secondary)" }}>
                    No matches
                  </div>
                )}
                {searchResults.map((result) => (
                  <div
                    key={`${result.messageId}-${result.seq}`}
                    onClick={() => {
                      setActiveSessionId(result.sessionId);
                      setSearchNavigationTarget({
                        sessionId: result.sessionId,
                        messageId: result.messageId,
                        nonce: Date.now(),
                      });
                    }}
                    style={{
                      padding: "10px 16px",
                      cursor: "pointer",
                      background: result.sessionId === activeSessionId ? "var(--bg-tertiary)" : "transparent",
                      fontSize: 12,
                      borderBottom: "1px solid var(--border)",
                    }}
                  >
                    <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
                      {result.sessionTitle ?? "Untitled"}
                    </div>
                    <div style={{ color: "var(--text-secondary)", lineHeight: 1.4 }}>{renderSnippet(result.snippet)}</div>
                  </div>
                ))}
              </>
            ) : (
              <>
                {sessionsLoading ? (
                  <div style={{ padding: "12px 16px", fontSize: 12, color: "var(--text-secondary)" }}>
                    Loading sessions…
                  </div>
                ) : null}
                {sessions.map((s: SessionSummary) => (
                  <div
                    key={s.id}
                    onClick={() => setActiveSessionId(s.id)}
                    style={{
                      padding: "10px 16px",
                      cursor: "pointer",
                      background: s.id === activeSessionId ? "var(--bg-tertiary)" : "transparent",
                      fontSize: 13,
                      borderBottom: "1px solid var(--border)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {s.title ?? "Untitled"}
                  </div>
                ))}
                {!sessionsLoading && sessions.length === 0 && (
                  <div style={{ padding: "12px 16px", fontSize: 12, color: "var(--text-secondary)" }}>
                    {showArchived ? "No archived sessions" : "No sessions yet"}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </ErrorBoundary>

      {/* Main area */}
      <ErrorBoundary region="Main area">
        <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
          {activeSessionId ? (
            <ChatView
              sessionId={activeSessionId}
              onSessionMutated={handleSessionMutated}
              searchNavigationTarget={
                searchNavigationTarget?.sessionId === activeSessionId
                  ? searchNavigationTarget
                  : null
              }
            />
          ) : (
            <div
              style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--text-muted)",
                fontSize: 16,
                background: "var(--bg-primary)",
              }}
            >
              Select or create a chat to get started
            </div>
          )}
        </div>
      </ErrorBoundary>
    </div>
  );
}
