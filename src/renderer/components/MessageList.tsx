import React, { useRef, useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ScorelMessage, AssistantMessage, ContentPart } from "@shared/types";
import type { SearchNavigationTarget } from "../message-navigation";
import { hasPendingSearchNavigationTarget } from "../message-navigation";
import type { ToolStatus } from "../hooks/useChat";

function toolStatusLabel(status: ToolStatus | undefined): string | null {
  if (!status) {
    return null;
  }

  switch (status.state) {
    case "awaiting_approval":
      return "Awaiting approval";
    case "running":
      return "Running";
    case "success":
      return "Completed";
    case "denied":
      return "Denied";
    case "error":
      return "Failed";
  }
}

export function renderContentPart(
  part: ContentPart,
  idx: number,
  toolStatuses: Record<string, ToolStatus>,
  sessionId: string | null,
  pendingApprovals: Record<string, boolean>,
  approvalErrors: Record<string, string>,
  onApprovalAction: (toolCallId: string, decision: "approve" | "deny") => void,
) {
  switch (part.type) {
    case "text":
      return (
        <div key={idx} className="scorel-markdown">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              a: ({ ...props }) => <a {...props} target="_blank" rel="noreferrer" />,
            }}
          >
            {part.text}
          </ReactMarkdown>
        </div>
      );
    case "toolCall": {
      const status = toolStatuses[part.id];
      const label = toolStatusLabel(status);
      const awaitingApproval = status?.state === "awaiting_approval";
      const approvalPending = pendingApprovals[part.id] ?? false;
      const approvalError = approvalErrors[part.id] ?? null;

      return (
        <div
          key={idx}
          style={{
            fontFamily: "monospace",
            fontSize: 12,
            background: "var(--tool-bg)",
            padding: "8px 10px",
            borderRadius: 10,
            margin: "6px 0",
            border: `1px solid ${status?.state === "error" ? "var(--danger)" : status?.state === "awaiting_approval" ? "var(--warning)" : "var(--border)"}`,
          }}
        >
          <div>{part.name}({JSON.stringify(part.arguments)})</div>
          {label ? (
            <div style={{ marginTop: 4, color: "var(--text-secondary)", display: "flex", alignItems: "center", gap: 6 }}>
              {(awaitingApproval || status?.state === "running") ? (
                <span
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: "50%",
                    background: status.state === "awaiting_approval" ? "var(--warning)" : "var(--accent)",
                    animation: status.state === "running" ? "scorel-pulse 1s ease infinite" : "none",
                  }}
                />
              ) : null}
              {label}
            </div>
          ) : null}
          {awaitingApproval && sessionId ? (
            <div style={{ marginTop: 10 }}>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  onClick={() => onApprovalAction(part.id, "approve")}
                  disabled={approvalPending}
                  style={{
                    padding: "6px 12px",
                    borderRadius: 8,
                    border: "none",
                    background: "var(--success)",
                    color: "#fff",
                    cursor: approvalPending ? "default" : "pointer",
                    opacity: approvalPending ? 0.7 : 1,
                  }}
                >
                  Approve
                </button>
                <button
                  onClick={() => onApprovalAction(part.id, "deny")}
                  disabled={approvalPending}
                  style={{
                    padding: "6px 12px",
                    borderRadius: 8,
                    border: "1px solid var(--border)",
                    background: "var(--bg-primary)",
                    color: "var(--text-primary)",
                    cursor: approvalPending ? "default" : "pointer",
                    opacity: approvalPending ? 0.7 : 1,
                  }}
                >
                  Deny
                </button>
              </div>
              {approvalError ? (
                <div style={{ marginTop: 8, color: "var(--danger)", fontSize: 12 }}>
                  {approvalError}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      );
    }
    case "thinking":
      return (
        <div
          key={idx}
          style={{ color: "var(--text-muted)", fontStyle: "italic", fontSize: 13 }}
        >
          {part.thinking}
        </div>
      );
  }
}

function MessageBubble({
  message,
  isStreaming,
  highlighted,
  bubbleRef,
  toolStatuses,
  sessionId,
  pendingApprovals,
  approvalErrors,
  onApprovalAction,
}: {
  message: ScorelMessage | AssistantMessage;
  isStreaming?: boolean;
  highlighted?: boolean;
  bubbleRef?: (element: HTMLDivElement | null) => void;
  toolStatuses: Record<string, ToolStatus>;
  sessionId: string | null;
  pendingApprovals: Record<string, boolean>;
  approvalErrors: Record<string, string>;
  onApprovalAction: (toolCallId: string, decision: "approve" | "deny") => void;
}) {
  const isUser = message.role === "user";
  const isAborted =
    message.role === "assistant" && message.stopReason === "aborted";

  return (
    <div
      ref={bubbleRef}
      style={{
        display: "flex",
        justifyContent: isUser ? "flex-end" : "flex-start",
        padding: "4px 16px",
      }}
    >
      <div
        style={{
          maxWidth: "80%",
          padding: "8px 12px",
          borderRadius: 12,
          background: isUser ? "var(--accent)" : "var(--bg-secondary)",
          color: isUser ? "#fff" : "var(--text-primary)",
          opacity: isAborted ? 0.5 : 1,
          boxShadow: highlighted ? "0 0 0 2px rgba(255, 204, 0, 0.9)" : "none",
          fontSize: 14,
          lineHeight: 1.5,
          transition: "box-shadow 0.2s ease",
        }}
      >
        {message.role === "user" && message.content}
        {message.role === "assistant" &&
          message.content.map((p, i) => renderContentPart(
            p,
            i,
            toolStatuses,
            sessionId,
            pendingApprovals,
            approvalErrors,
            onApprovalAction,
          ))}
        {message.role === "toolResult" && (
          <div style={{ fontFamily: "monospace", fontSize: 12 }}>
            [{message.toolName}]{" "}
            {message.content.map((p) => p.text).join("\n")}
          </div>
        )}
        {isStreaming && (
          <span
            style={{
              display: "inline-block",
              width: 6,
              height: 14,
              background: "var(--accent)",
              marginLeft: 2,
              animation: "scorel-blink 1s infinite",
            }}
          />
        )}
      </div>
    </div>
  );
}

export function MessageList({
  messages,
  streamingMessage,
  searchNavigationTarget,
  toolStatuses,
  sessionId,
}: {
  messages: ScorelMessage[];
  streamingMessage: AssistantMessage | null;
  searchNavigationTarget: SearchNavigationTarget | null;
  toolStatuses: Record<string, ToolStatus>;
  sessionId: string | null;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const messageRefs = useRef(new Map<string, HTMLDivElement>());
  const lastHandledTargetNonceRef = useRef<number | null>(null);
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const [pendingApprovals, setPendingApprovals] = useState<Record<string, boolean>>({});
  const [approvalErrors, setApprovalErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    setPendingApprovals((current) => Object.fromEntries(
      Object.entries(current).filter(([toolCallId]) => toolStatuses[toolCallId]?.state === "awaiting_approval"),
    ));
    setApprovalErrors((current) => Object.fromEntries(
      Object.entries(current).filter(([toolCallId]) => toolStatuses[toolCallId]?.state === "awaiting_approval"),
    ));
  }, [toolStatuses]);

  useEffect(() => {
    if (!hasPendingSearchNavigationTarget(searchNavigationTarget, lastHandledTargetNonceRef.current)) {
      return;
    }

    if (!searchNavigationTarget) {
      return;
    }

    const targetElement = messageRefs.current.get(searchNavigationTarget.messageId);
    if (!targetElement) {
      return;
    }

    targetElement.scrollIntoView({ behavior: "smooth", block: "center" });
    lastHandledTargetNonceRef.current = searchNavigationTarget.nonce;
    setHighlightedMessageId(searchNavigationTarget.messageId);

    const timer = window.setTimeout(() => {
      setHighlightedMessageId((current) => (
        current === searchNavigationTarget.messageId ? null : current
      ));
    }, 2200);

    return () => {
      window.clearTimeout(timer);
    };
  }, [messages, searchNavigationTarget]);

  useEffect(() => {
    if (hasPendingSearchNavigationTarget(searchNavigationTarget, lastHandledTargetNonceRef.current)) {
      return;
    }

    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingMessage, searchNavigationTarget]);

  const handleApprovalAction = (toolCallId: string, decision: "approve" | "deny") => {
    if (!sessionId) {
      return;
    }

    setApprovalErrors((current) => {
      if (!(toolCallId in current)) {
        return current;
      }

      const next = { ...current };
      delete next[toolCallId];
      return next;
    });
    setPendingApprovals((current) => ({ ...current, [toolCallId]: true }));

    const action = decision === "approve"
      ? window.scorel.tools.approve(sessionId, toolCallId)
      : window.scorel.tools.deny(sessionId, toolCallId);

    void action.catch((error: unknown) => {
      setPendingApprovals((current) => {
        const next = { ...current };
        delete next[toolCallId];
        return next;
      });
      setApprovalErrors((current) => ({
        ...current,
        [toolCallId]: error instanceof Error ? error.message : "Approval action failed",
      }));
    });
  };

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}>
      {messages.map((msg) => (
        <MessageBubble
          key={msg.id}
          message={msg}
          highlighted={msg.id === highlightedMessageId}
          toolStatuses={toolStatuses}
          sessionId={sessionId}
          pendingApprovals={pendingApprovals}
          approvalErrors={approvalErrors}
          onApprovalAction={handleApprovalAction}
          bubbleRef={(element) => {
            if (element) {
              messageRefs.current.set(msg.id, element);
              return;
            }

            messageRefs.current.delete(msg.id);
          }}
        />
      ))}
      {streamingMessage && (
        <MessageBubble
          message={streamingMessage}
          isStreaming
          toolStatuses={toolStatuses}
          sessionId={sessionId}
          pendingApprovals={pendingApprovals}
          approvalErrors={approvalErrors}
          onApprovalAction={handleApprovalAction}
        />
      )}
      <div ref={bottomRef} />
    </div>
  );
}
