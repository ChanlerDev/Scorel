import { useRef, useEffect } from "react";
import type { ScorelMessage, AssistantMessage, ContentPart } from "@shared/types";

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
}: {
  message: ScorelMessage | AssistantMessage;
  isStreaming?: boolean;
}) {
  const isUser = message.role === "user";
  const isAborted =
    message.role === "assistant" && message.stopReason === "aborted";

  return (
    <div
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
          fontSize: 14,
          lineHeight: 1.5,
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
}: {
  messages: ScorelMessage[];
  streamingMessage: AssistantMessage | null;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingMessage]);

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}>
      {messages.map((msg) => (
        <MessageBubble key={msg.id} message={msg} />
      ))}
      {streamingMessage && (
        <MessageBubble message={streamingMessage} isStreaming />
      )}
      <div ref={bottomRef} />
    </div>
  );
}
