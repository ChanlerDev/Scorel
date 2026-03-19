import { useState, useCallback, type KeyboardEvent } from "react";

export function ChatInput({
  onSend,
  onAbort,
  isStreaming,
  disabled,
}: {
  onSend: (text: string) => void;
  onAbort: () => void;
  isStreaming: boolean;
  disabled: boolean;
}) {
  const [text, setText] = useState("");

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setText("");
  }, [text, disabled, onSend]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  return (
    <div
      style={{
        display: "flex",
        gap: 8,
        padding: "8px 16px",
        borderTop: "1px solid #e0e0e0",
        background: "#fff",
      }}
    >
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Send a message..."
        disabled={disabled}
        rows={1}
        style={{
          flex: 1,
          resize: "none",
          border: "1px solid #ccc",
          borderRadius: 8,
          padding: "8px 12px",
          fontSize: 14,
          fontFamily: "inherit",
          outline: "none",
        }}
      />
      {isStreaming ? (
        <button
          onClick={onAbort}
          style={{
            padding: "8px 16px",
            borderRadius: 8,
            border: "none",
            background: "#ff3b30",
            color: "#fff",
            cursor: "pointer",
            fontSize: 14,
          }}
        >
          Stop
        </button>
      ) : (
        <button
          onClick={handleSend}
          disabled={disabled || !text.trim()}
          style={{
            padding: "8px 16px",
            borderRadius: 8,
            border: "none",
            background: disabled || !text.trim() ? "#ccc" : "#007aff",
            color: "#fff",
            cursor: disabled || !text.trim() ? "default" : "pointer",
            fontSize: 14,
          }}
        >
          Send
        </button>
      )}
    </div>
  );
}
