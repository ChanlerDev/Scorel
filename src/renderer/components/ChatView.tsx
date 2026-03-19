import { MessageList } from "./MessageList";
import { ChatInput } from "./ChatInput";
import { useChat } from "../hooks/useChat";

export function ChatView({ sessionId }: { sessionId: string }) {
  const { messages, streamingMessage, chatState, error, send, abort } =
    useChat(sessionId);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
      }}
    >
      <MessageList messages={messages} streamingMessage={streamingMessage} />
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
