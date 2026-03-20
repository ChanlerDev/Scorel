import { useMemo, useState } from "react";
import { MessageList } from "./MessageList";
import { ChatInput } from "./ChatInput";
import { useChat } from "../hooks/useChat";
import { useSessionDetail } from "../hooks/useSession";
import type { SearchNavigationTarget } from "../message-navigation";

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

export function ChatView({
  sessionId,
  onSessionMutated,
  searchNavigationTarget,
}: {
  sessionId: string;
  onSessionMutated: (action: "archive" | "unarchive" | "delete") => void | Promise<void>;
  searchNavigationTarget: SearchNavigationTarget | null;
}) {
  const { messages, streamingMessage, chatState, error, send, abort } =
    useChat(sessionId);
  const { detail } = useSessionDetail(sessionId);
  const [redactExports, setRedactExports] = useState(true);
  const [actionError, setActionError] = useState<string | null>(null);

  const exportBaseName = useMemo(() => {
    const rawName = detail?.title ?? sessionId;
    return sanitizeFileName(rawName);
  }, [detail?.title, sessionId]);

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
          borderBottom: "1px solid #e0e0e0",
          background: "#fafafa",
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 600 }}>
            {detail?.title ?? "Untitled"}
          </div>
          <div
            style={{
              fontSize: 12,
              color: "#666",
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
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#555" }}>
            <input
              type="checkbox"
              checked={redactExports}
              onChange={(event) => setRedactExports(event.target.checked)}
            />
            Redact exports
          </label>
          <button onClick={() => handleExport("jsonl")}>Export JSONL</button>
          <button onClick={() => handleExport("md")}>Export Markdown</button>
          <button onClick={handleArchiveToggle}>
            {detail?.archived ? "Unarchive" : "Archive"}
          </button>
          <button onClick={handleDelete} style={{ color: "#b42318" }}>
            Delete
          </button>
        </div>
      </div>
      {actionError && (
        <div
          style={{
            padding: "6px 16px",
            fontSize: 13,
            color: "#ff3b30",
            background: "#fff5f5",
          }}
        >
          {actionError}
        </div>
      )}
      <MessageList
        messages={messages}
        streamingMessage={streamingMessage}
        searchNavigationTarget={searchNavigationTarget}
      />
      {error && (
        <div
          style={{
            padding: "6px 16px",
            fontSize: 13,
            color: "#ff3b30",
            background: "#fff5f5",
          }}
        >
          {error}
        </div>
      )}
      <ChatInput
        onSend={send}
        onAbort={abort}
        isStreaming={chatState === "streaming"}
        disabled={chatState === "streaming"}
      />
    </div>
  );
}
