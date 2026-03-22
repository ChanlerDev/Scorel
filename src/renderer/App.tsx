import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import type { SearchResult, SessionSummary, WorkspaceEntry } from "@shared/types";
import { ChatView } from "./components/ChatView";
import { SetupWizard } from "./components/setup-wizard";
import { ErrorBoundary } from "./components/error-boundary";
import { SettingsView } from "./components/SettingsView";
import { WorkspacePicker } from "./components/WorkspacePicker";
import { useSessionList } from "./hooks/useSession";
import { useTheme } from "./hooks/use-theme";
import type { SearchNavigationTarget } from "./message-navigation";

type AppView = "chat" | "settings";

export async function createSessionInDefaultWorkspace(
  scorel: Pick<Window["scorel"], "app" | "sessions">,
  providerId: string,
  modelId: string,
): Promise<{ sessionId: string; workspaceRoot: string }> {
  const workspaceRoot = await scorel.app.getDefaultWorkspace();
  const { sessionId } = await scorel.sessions.create({
    providerId,
    modelId,
    workspaceRoot,
  });
  return { sessionId, workspaceRoot };
}

export async function switchSessionWorkspace(
  scorel: Pick<Window["scorel"], "sessions">,
  sessionId: string,
  workspaceRoot: string,
): Promise<void> {
  await scorel.sessions.updateWorkspace(sessionId, workspaceRoot);
}

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
  const [appView, setAppView] = useState<AppView>("chat");
  const [providerId, setProviderId] = useState<string | null>(null);
  const [modelId, setModelId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchNavigationTarget, setSearchNavigationTarget] = useState<SearchNavigationTarget | null>(null);
  const [workspacePickerOpen, setWorkspacePickerOpen] = useState(false);
  const [workspacePickerLoading, setWorkspacePickerLoading] = useState(false);
  const [workspacePickerError, setWorkspacePickerError] = useState<string | null>(null);
  const [defaultWorkspace, setDefaultWorkspace] = useState("");
  const [workspaceHistory, setWorkspaceHistory] = useState<WorkspaceEntry[]>([]);
  const [creatingSession, setCreatingSession] = useState(false);
  const [workspacePickerSessionId, setWorkspacePickerSessionId] = useState<string | null>(null);
  const [chatViewVersion, setChatViewVersion] = useState(0);
  const shouldAutoSelectFirstSessionRef = useRef(true);

  const refreshActiveProvider = useCallback(async (preferred?: { providerId?: string | null; modelId?: string | null } | null) => {
    const providers = await window.scorel.providers.list();

    const nextProvider = (preferred?.providerId
      ? providers.find((provider) => provider.id === preferred.providerId)
      : null) ?? providers[0] ?? null;

    const nextModelId = nextProvider
      ? (preferred?.modelId && nextProvider.models.some((model) => model.id === preferred.modelId)
        ? preferred.modelId
        : nextProvider.models[0]?.id ?? null)
      : null;

    if (!nextProvider || !nextModelId) {
      setProviderId(null);
      setModelId(null);
      setAppState("setup");
      return null;
    }

    setProviderId(nextProvider.id);
    setModelId(nextModelId);
    setAppState("ready");

    return {
      providerId: nextProvider.id,
      modelId: nextModelId,
    };
  }, []);

  const handleProviderDone = useCallback(
    async (result: { providerId: string; modelId: string; sessionId: string }) => {
      shouldAutoSelectFirstSessionRef.current = false;
      setProviderId(result.providerId);
      setModelId(result.modelId);
      setActiveSessionId(result.sessionId);
      setAppState("ready");
      setAppView("chat");
      await refresh();
    },
    [refresh],
  );

  const openWorkspacePicker = useCallback(async (sessionId: string) => {
    setWorkspacePickerOpen(true);
    setWorkspacePickerError(null);
    setWorkspacePickerLoading(true);
    setWorkspacePickerSessionId(sessionId);

    try {
      const [nextDefaultWorkspace, nextWorkspaceHistory] = await Promise.all([
        window.scorel.app.getDefaultWorkspace(),
        window.scorel.workspaces.list(20),
      ]);

      setDefaultWorkspace(nextDefaultWorkspace);
      setWorkspaceHistory(nextWorkspaceHistory);
    } catch (error: unknown) {
      setWorkspacePickerError(error instanceof Error ? error.message : String(error));
    } finally {
      setWorkspacePickerLoading(false);
    }
  }, []);

  const createSessionAtWorkspace = useCallback(async (workspaceRoot: string) => {
    if (!providerId || !modelId) {
      return;
    }

    setCreatingSession(true);
    setWorkspacePickerError(null);

    try {
      const { sessionId } = await window.scorel.sessions.create({
        providerId,
        modelId,
        workspaceRoot,
      });
      shouldAutoSelectFirstSessionRef.current = false;
      await refresh();
      setActiveSessionId(sessionId);
      setAppView("chat");
      setWorkspacePickerOpen(false);
    } catch (error: unknown) {
      setWorkspacePickerError(error instanceof Error ? error.message : String(error));
    } finally {
      setCreatingSession(false);
    }
  }, [modelId, providerId, refresh]);

  const handleBrowseWorkspace = useCallback(async () => {
    const workspaceRoot = await window.scorel.app.selectDirectory();
    if (!workspaceRoot) {
      return;
    }

    if (workspacePickerSessionId) {
      try {
        setWorkspacePickerError(null);
        await switchSessionWorkspace(window.scorel, workspacePickerSessionId, workspaceRoot);
        await refresh();
        setChatViewVersion((version) => version + 1);
        setWorkspacePickerOpen(false);
        setWorkspacePickerSessionId(null);
      } catch (error: unknown) {
        setWorkspacePickerError(error instanceof Error ? error.message : String(error));
      }
      return;
    }

    await createSessionAtWorkspace(workspaceRoot);
  }, [createSessionAtWorkspace, refresh, workspacePickerSessionId]);

  const handleNewSession = useCallback(async () => {
    if (!providerId || !modelId) {
      return;
    }

    setCreatingSession(true);
    try {
      setWorkspacePickerError(null);
      const { sessionId, workspaceRoot } = await createSessionInDefaultWorkspace(window.scorel, providerId, modelId);
      setDefaultWorkspace(workspaceRoot);
      shouldAutoSelectFirstSessionRef.current = false;
      await refresh();
      setActiveSessionId(sessionId);
      setAppView("chat");
    } catch (error: unknown) {
      setWorkspacePickerError(error instanceof Error ? error.message : String(error));
    } finally {
      setCreatingSession(false);
    }
  }, [modelId, providerId, refresh]);

  const handleProvidersChanged = useCallback(async (selection?: { providerId: string; modelId: string } | null) => {
    const activeProvider = await refreshActiveProvider(selection ?? null);
    if (!activeProvider) {
      shouldAutoSelectFirstSessionRef.current = false;
      setActiveSessionId(null);
    }
  }, [refreshActiveProvider]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const activeProvider = await refreshActiveProvider();
      if (cancelled) {
        return;
      }

      if (!activeProvider) {
        setAppState("setup");
        return;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [refreshActiveProvider]);

  useEffect(() => {
    if (
      appState !== "ready"
      || activeSessionId
      || sessions.length === 0
      || !shouldAutoSelectFirstSessionRef.current
    ) {
      return;
    }

    shouldAutoSelectFirstSessionRef.current = false;
    setActiveSessionId(sessions[0]?.id ?? null);
  }, [appState, activeSessionId, sessions]);

  useEffect(() => {
    return window.scorel.menu.onNewSession(() => {
      void handleNewSession();
    });
  }, [handleNewSession]);

  useEffect(() => {
    return window.scorel.menu.onSettings(() => {
      setAppView("settings");
    });
  }, []);

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
      shouldAutoSelectFirstSessionRef.current = false;
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
                      shouldAutoSelectFirstSessionRef.current = false;
                      setActiveSessionId(result.sessionId);
                      setAppView("chat");
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
                    onClick={() => {
                      shouldAutoSelectFirstSessionRef.current = false;
                      setActiveSessionId(s.id);
                      setAppView("chat");
                    }}
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

          <div style={{ padding: 16, borderTop: "1px solid var(--border)" }}>
            <button
              onClick={() => setAppView("settings")}
              style={{
                width: "100%",
                padding: "8px 0",
                borderRadius: 10,
                border: "1px solid var(--border)",
                background: appView === "settings" ? "var(--bg-tertiary)" : "var(--bg-primary)",
                color: "var(--text-primary)",
                cursor: "pointer",
              }}
            >
              Settings
            </button>
          </div>
        </div>
      </ErrorBoundary>

      {/* Main area */}
      <ErrorBoundary region="Main area">
        <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
          {appView === "settings" ? (
            <SettingsView
              onClose={() => setAppView("chat")}
              onProvidersChanged={handleProvidersChanged}
            />
          ) : activeSessionId ? (
            <ChatView
              key={`${activeSessionId}:${chatViewVersion}`}
              sessionId={activeSessionId}
              onSessionMutated={handleSessionMutated}
              onChangeWorkspace={(sessionId) => {
                void openWorkspacePicker(sessionId);
              }}
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

      {workspacePickerOpen ? (
        <WorkspacePicker
          defaultWorkspace={defaultWorkspace}
          workspaces={workspaceHistory}
          loading={workspacePickerLoading}
          creating={creatingSession}
          error={workspacePickerError}
          onUseWorkspace={(workspacePath) => {
            if (!workspacePickerSessionId) {
              void createSessionAtWorkspace(workspacePath);
              return;
            }

            void (async () => {
              try {
                setWorkspacePickerError(null);
                await switchSessionWorkspace(window.scorel, workspacePickerSessionId, workspacePath);
                await refresh();
                setChatViewVersion((version) => version + 1);
                setWorkspacePickerOpen(false);
                setWorkspacePickerSessionId(null);
              } catch (error: unknown) {
                setWorkspacePickerError(error instanceof Error ? error.message : String(error));
              }
            })();
          }}
          onBrowse={() => {
            void handleBrowseWorkspace();
          }}
          onClose={() => {
            if (!creatingSession) {
              setWorkspacePickerOpen(false);
              setWorkspacePickerSessionId(null);
            }
          }}
        />
      ) : null}
    </div>
  );
}
