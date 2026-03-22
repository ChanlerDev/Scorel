import { useEffect, useMemo, useState } from "react";
import { MessageList } from "./MessageList";
import { ChatInput } from "./ChatInput";
import { TodoPanel } from "./TodoPanel";
import { useChat } from "../hooks/useChat";
import { useSessionDetail } from "../hooks/useSession";
import type { SearchNavigationTarget } from "../message-navigation";
import type { ScorelEvent } from "@shared/events";

function sanitizeFileName(value: string): string {
  return value.replace(/[^a-z0-9-_]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "session";
}

function downloadTextFile(fileName: string, content: string, type: string): void {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function getCompactEventNotice(
  event: ScorelEvent,
): { tone: "success" | "warning"; message: string } | null {
  if (event.type === "compact.failed") {
    return {
      tone: "warning",
      message: `Auto-compact failed: ${event.error}`,
    };
  }

  if (event.type === "compact.auto") {
    return {
      tone: "success",
      message: "Conversation auto-compacted successfully",
    };
  }

  return null;
}

export function ChatView({
  sessionId,
  onSessionMutated,
  onChangeWorkspace,
  searchNavigationTarget,
}: {
  sessionId: string;
  onSessionMutated: (action: "archive" | "unarchive" | "delete") => void | Promise<void>;
  onChangeWorkspace: (sessionId: string) => void | Promise<void>;
  searchNavigationTarget: SearchNavigationTarget | null;
}) {
  const { messages, streamingMessage, chatState, error, send, abort, toolStatuses } =
    useChat(sessionId);
  const { detail, loading, refresh } = useSessionDetail(sessionId);
  const [redactExports, setRedactExports] = useState(true);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isCompacting, setIsCompacting] = useState(false);
  const [compactStatus, setCompactStatus] = useState<string | null>(null);
  const [compactStatusTone, setCompactStatusTone] = useState<"success" | "warning">("success");

  const exportBaseName = useMemo(() => {
    const rawName = detail?.title ?? sessionId;
    return sanitizeFileName(rawName);
  }, [detail?.title, sessionId]);

  const isBusy = chatState === "streaming" || chatState === "awaiting_approval" || chatState === "tooling";
  const activityLabel = isCompacting
    ? "Compacting conversation…"
    : chatState === "streaming"
      ? "Thinking…"
      : chatState === "awaiting_approval"
        ? "Awaiting tool approval…"
        : chatState === "tooling"
          ? "Running tools…"
          : null;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && isBusy) {
        event.preventDefault();
        abort();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [abort, isBusy]);

  useEffect(() => {
    const unsubscribe = window.scorel.chat.onEvent(sessionId, (event) => {
      if (event.type !== "compact.failed" && event.type !== "compact.auto") {
        return;
      }

      const notice = getCompactEventNotice(event);
      if (!notice) {
        return;
      }

      setCompactStatus(notice.message);
      setCompactStatusTone(notice.tone);
    });

    return unsubscribe;
  }, [sessionId]);

  const handleExport = async (format: "jsonl" | "md") => {
    try {
      setActionError(null);
      const content = format === "jsonl"
        ? await window.scorel.sessions.exportJsonl(sessionId, { redact: redactExports })
        : await window.scorel.sessions.exportMarkdown(sessionId, { redact: redactExports });
      downloadTextFile(
        `${exportBaseName}.${format}`,
        content,
        format === "jsonl" ? "application/x-ndjson;charset=utf-8" : "text/markdown;charset=utf-8",
      );
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleArchiveToggle = async () => {
    try {
      setActionError(null);
      if (detail?.archived) {
        await window.scorel.sessions.unarchive(sessionId);
        await onSessionMutated("unarchive");
        return;
      }

      await window.scorel.sessions.archive(sessionId);
      await onSessionMutated("archive");
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleDelete = async () => {
    if (!window.confirm("Delete this session permanently?")) {
      return;
    }

    try {
      setActionError(null);
      await window.scorel.sessions.delete(sessionId);
      await onSessionMutated("delete");
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleCompact = async () => {
    try {
      setActionError(null);
      setCompactStatus(null);
      setIsCompacting(true);
      await window.scorel.compact.manual(sessionId);
      setCompactStatus("Conversation compacted successfully");
      setCompactStatusTone("success");
      await refresh();
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsCompacting(false);
    }
  };

  if (loading && !detail) {
    return (
      <div style={{ flex: 1, padding: 24, background: "var(--bg-primary)" }}>
        <div style={{ width: 220, height: 20, borderRadius: 10, background: "var(--bg-tertiary)", marginBottom: 12 }} />
        <div style={{ width: 320, height: 14, borderRadius: 10, background: "var(--bg-secondary)", marginBottom: 20 }} />
        <div style={{ display: "grid", gap: 12 }}>
          {[0, 1, 2].map((index) => (
            <div key={index} style={{ height: 72, borderRadius: 16, background: "var(--bg-secondary)" }} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          padding: "12px 16px",
          borderBottom: "1px solid var(--border)",
          background: "var(--bg-elevated)",
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 600 }}>
            {detail?.title ?? "Untitled"}
          </div>
          <div
            style={{
              fontSize: 12,
              color: "var(--text-secondary)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {detail?.workspaceRoot ?? sessionId}
            {detail?.archived ? " · archived" : ""}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text-secondary)" }}>
            <input
              type="checkbox"
              checked={redactExports}
              onChange={(event) => setRedactExports(event.target.checked)}
            />
            Redact exports
          </label>
          <button onClick={() => void handleCompact()} disabled={isBusy || isCompacting}>
            {isCompacting ? "Compacting…" : "Compact"}
          </button>
          <button onClick={() => void onChangeWorkspace(sessionId)} disabled={isBusy || isCompacting}>
            Workspace
          </button>
          <button onClick={() => handleExport("jsonl")}>Export JSONL</button>
          <button onClick={() => handleExport("md")}>Export Markdown</button>
          <button onClick={handleArchiveToggle}>
            {detail?.archived ? "Unarchive" : "Archive"}
          </button>
          <button onClick={handleDelete} style={{ color: "var(--danger)" }}>
            Delete
          </button>
        </div>
      </div>
      {activityLabel && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "8px 16px",
            borderBottom: "1px solid var(--border)",
            background: isCompacting ? "var(--warning-bg)" : "var(--bg-secondary)",
            color: isCompacting ? "var(--warning)" : "var(--text-secondary)",
            fontSize: 13,
          }}
        >
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: "50%",
              background: isCompacting ? "var(--warning)" : "var(--accent)",
              animation: "scorel-pulse 1s ease infinite",
            }}
          />
          {activityLabel}
        </div>
      )}
      {compactStatus && !actionError && (
        <div
          style={{
            padding: "6px 16px",
            fontSize: 13,
            color: compactStatusTone === "success" ? "var(--success)" : "var(--warning)",
            background: compactStatusTone === "success" ? "var(--success-bg)" : "var(--warning-bg)",
          }}
        >
          {compactStatus}
        </div>
      )}
      {actionError && (
        <div
          style={{
            padding: "6px 16px",
            fontSize: 13,
            color: "var(--danger)",
            background: "var(--danger-bg)",
          }}
        >
          {actionError}
        </div>
      )}
      <TodoPanel sessionId={sessionId} />
      <MessageList
        messages={messages}
        streamingMessage={streamingMessage}
        searchNavigationTarget={searchNavigationTarget}
        toolStatuses={toolStatuses}
        sessionId={sessionId}
      />
      {error && (
        <div
          style={{
            padding: "6px 16px",
            fontSize: 13,
            color: "var(--danger)",
            background: "var(--danger-bg)",
          }}
        >
          {error}
        </div>
      )}
      <ChatInput
        onSend={send}
        onAbort={abort}
        isStreaming={isBusy}
        disabled={isBusy || isCompacting}
      />
    </div>
  );
}
