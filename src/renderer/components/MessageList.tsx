import { useRef, useEffect, useState } from "react";
import type { ScorelMessage, AssistantMessage, ContentPart } from "@shared/types";
import type { SearchNavigationTarget } from "../message-navigation";
import { hasPendingSearchNavigationTarget } from "../message-navigation";

function renderContentPart(part: ContentPart, idx: number) {
  switch (part.type) {
    case "text":
      return (
        <span key={idx} style={{ whiteSpace: "pre-wrap" }}>
          {part.text}
        </span>
      );
    case "toolCall":
      return (
        <div
          key={idx}
          style={{
            fontFamily: "monospace",
            fontSize: 12,
            background: "#f0f0f0",
            padding: "4px 8px",
            borderRadius: 4,
            margin: "4px 0",
          }}
        >
          🔧 {part.name}({JSON.stringify(part.arguments)})
        </div>
      );
    case "thinking":
      return (
        <div
          key={idx}
          style={{ color: "#888", fontStyle: "italic", fontSize: 13 }}
        >
          💭 {part.thinking}
        </div>
      );
  }
}

function MessageBubble({
  message,
  isStreaming,
  highlighted,
  bubbleRef,
}: {
  message: ScorelMessage | AssistantMessage;
  isStreaming?: boolean;
  highlighted?: boolean;
  bubbleRef?: (element: HTMLDivElement | null) => void;
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
          background: isUser ? "#007aff" : "#e9e9eb",
          color: isUser ? "#fff" : "#000",
          opacity: isAborted ? 0.5 : 1,
          boxShadow: highlighted ? "0 0 0 2px rgba(255, 204, 0, 0.9)" : "none",
          fontSize: 14,
          lineHeight: 1.5,
          transition: "box-shadow 0.2s ease",
        }}
      >
        {message.role === "user" && message.content}
        {message.role === "assistant" &&
          message.content.map((p, i) => renderContentPart(p, i))}
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
              background: "#007aff",
              marginLeft: 2,
              animation: "blink 1s infinite",
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
}: {
  messages: ScorelMessage[];
  streamingMessage: AssistantMessage | null;
  searchNavigationTarget: SearchNavigationTarget | null;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const messageRefs = useRef(new Map<string, HTMLDivElement>());
  const lastHandledTargetNonceRef = useRef<number | null>(null);
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);

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

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}>
      {messages.map((msg) => (
        <MessageBubble
          key={msg.id}
          message={msg}
          highlighted={msg.id === highlightedMessageId}
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
        <MessageBubble message={streamingMessage} isStreaming />
      )}
      <div ref={bottomRef} />
    </div>
  );
}
