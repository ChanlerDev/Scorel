import { useState, useEffect, useCallback, useRef } from "react";
import type { ScorelMessage, AssistantMessage } from "@shared/types";
import type { AssistantMessageEvent, ScorelEvent } from "@shared/events";

type ChatState = "idle" | "streaming" | "error";

export function useChat(sessionId: string | null) {
  const [messages, setMessages] = useState<ScorelMessage[]>([]);
  const [streamingMessage, setStreamingMessage] =
    useState<AssistantMessage | null>(null);
  const [chatState, setChatState] = useState<ChatState>("idle");
  const [error, setError] = useState<string | null>(null);
  const unsubRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!sessionId) {
      setMessages([]);
      setStreamingMessage(null);
      setChatState("idle");
      return;
    }

    window.scorel.sessions.get(sessionId).then((detail) => {
      if (detail) setMessages(detail.messages);
    });

    const unsub = window.scorel.chat.onEvent(
      sessionId,
      (event: AssistantMessageEvent | ScorelEvent) => {
        if (
          event.type !== "start" &&
          event.type !== "text_delta" &&
          event.type !== "text_end" &&
          event.type !== "toolcall_delta" &&
          event.type !== "toolcall_end" &&
          event.type !== "done" &&
          event.type !== "error"
        ) {
          return;
        }

        const e = event as AssistantMessageEvent;
        switch (e.type) {
          case "start":
            setChatState("streaming");
            setStreamingMessage(e.partial);
            break;
          case "text_delta":
          case "toolcall_delta":
            setStreamingMessage(e.partial);
            break;
          case "text_end":
          case "toolcall_end":
            setStreamingMessage(e.partial);
            break;
          case "done":
            setStreamingMessage(null);
            setChatState("idle");
            setMessages((prev) => [...prev, e.message]);
            break;
          case "error":
            setStreamingMessage(null);
            setChatState("error");
            setError(e.error.errorMessage ?? "Stream error");
            if (
              e.error.content.some(
                (p) => p.type === "text" && p.text.length > 0,
              )
            ) {
              setMessages((prev) => [...prev, e.error]);
            }
            break;
          default:
            break;
        }
      },
    );
    unsubRef.current = unsub;

    return () => {
      unsub();
      unsubRef.current = null;
    };
  }, [sessionId]);

  const send = useCallback(
    async (text: string) => {
      if (!sessionId || chatState === "streaming") return;
      setError(null);
      const userMsg: ScorelMessage = {
        role: "user",
        id: `pending-${Date.now()}`,
        content: text,
        ts: Date.now(),
      };
      setMessages((prev) => [...prev, userMsg]);
      try {
        await window.scorel.chat.send(sessionId, text);
      } catch (err: unknown) {
        setChatState("error");
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [sessionId, chatState],
  );

  const abort = useCallback(() => {
    if (sessionId) {
      window.scorel.chat.abort(sessionId);
    }
  }, [sessionId]);

  return { messages, streamingMessage, chatState, error, send, abort };
}
