import { useState, useEffect, useCallback, useRef } from "react";
import type { ScorelMessage, AssistantMessage } from "@shared/types";
import type { AssistantMessageEvent, ScorelEvent } from "@shared/events";

export type ChatState = "idle" | "streaming" | "awaiting_approval" | "tooling" | "error";

export type ToolStatus = {
  toolCallId: string;
  toolName: string;
  state: "awaiting_approval" | "running" | "success" | "denied" | "error";
  detail?: string;
};

function appendUniqueMessage(messages: ScorelMessage[], message: ScorelMessage): ScorelMessage[] {
  if (messages.some((existing) => existing.id === message.id)) {
    return messages;
  }

  return [...messages, message];
}

export function useChat(sessionId: string | null) {
  const [messages, setMessages] = useState<ScorelMessage[]>([]);
  const [streamingMessage, setStreamingMessage] =
    useState<AssistantMessage | null>(null);
  const [chatState, setChatState] = useState<ChatState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [toolStatuses, setToolStatuses] = useState<Record<string, ToolStatus>>({});
  const unsubRef = useRef<(() => void) | null>(null);
  const sessionIdRef = useRef<string | null>(sessionId);

  const loadMessages = useCallback(async (targetSessionId: string) => {
    const detail = await window.scorel.sessions.get(targetSessionId);
    if (sessionIdRef.current === targetSessionId) {
      setMessages(detail?.messages ?? []);
    }
  }, []);

  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId) {
      setMessages([]);
      setStreamingMessage(null);
      setChatState("idle");
      setToolStatuses({});
      return;
    }

    void loadMessages(sessionId);
    setToolStatuses({});
    setError(null);
    setStreamingMessage(null);
    setChatState("idle");

    const unsub = window.scorel.chat.onEvent(
      sessionId,
      (event: AssistantMessageEvent | ScorelEvent) => {
        switch (event.type) {
          case "start":
            setChatState("streaming");
            setStreamingMessage(event.partial);
            break;
          case "text_delta":
          case "toolcall_delta":
          case "thinking_delta":
            setStreamingMessage(event.partial);
            break;
          case "text_end":
          case "toolcall_end":
          case "thinking_end":
            setStreamingMessage(event.partial);
            break;
          case "done":
            setStreamingMessage(null);
            setChatState(event.reason === "toolUse" ? "tooling" : "idle");
            setMessages((prev) => appendUniqueMessage(prev, event.message));
            break;
          case "error":
            setStreamingMessage(null);
            setChatState(event.reason === "aborted" ? "idle" : "error");
            setError(event.error.errorMessage ?? "Stream error");
            if (
              event.error.content.some(
                (p) => p.type === "text" && p.text.length > 0,
              )
            ) {
              setMessages((prev) => appendUniqueMessage(prev, event.error));
            }
            break;
          case "approval.requested":
            setChatState("awaiting_approval");
            setToolStatuses((current) => ({
              ...current,
              [event.toolCall.toolCallId]: {
                toolCallId: event.toolCall.toolCallId,
                toolName: event.toolCall.name,
                state: "awaiting_approval",
              },
            }));
            break;
          case "approval.resolved":
            setChatState(event.decision === "approved" ? "tooling" : "idle");
            setToolStatuses((current) => {
              const existing = current[event.toolCallId];
              if (!existing) {
                return current;
              }

              return {
                ...current,
                [event.toolCallId]: {
                  ...existing,
                  state: event.decision === "approved" ? "running" : "denied",
                },
              };
            });
            break;
          case "tool.exec.start":
            setChatState("tooling");
            setToolStatuses((current) => ({
              ...current,
              [event.toolCall.toolCallId]: {
                toolCallId: event.toolCall.toolCallId,
                toolName: event.toolCall.name,
                state: "running",
              },
            }));
            break;
          case "tool.exec.update":
            setToolStatuses((current) => {
              const existing = current[event.toolCallId];
              if (!existing) {
                return current;
              }

              return {
                ...current,
                [event.toolCallId]: {
                  ...existing,
                  detail: event.partial,
                },
              };
            });
            break;
          case "tool.exec.end":
            setChatState("tooling");
            setToolStatuses((current) => {
              const existing = current[event.result.toolCallId];
              if (!existing) {
                return current;
              }

              return {
                ...current,
                [event.result.toolCallId]: {
                  ...existing,
                  state: event.result.isError ? "error" : "success",
                  detail: event.result.content,
                },
              };
            });
            break;
          case "session.abort":
            setStreamingMessage(null);
            setChatState("idle");
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
  }, [sessionId, loadMessages]);

  const send = useCallback(
    async (text: string) => {
      if (!sessionId || chatState !== "idle") return;
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
      } finally {
        await loadMessages(sessionId);
      }
    },
    [sessionId, chatState, loadMessages],
  );

  const abort = useCallback(() => {
    if (sessionId) {
      window.scorel.chat.abort(sessionId);
    }
  }, [sessionId]);

  return { messages, streamingMessage, chatState, error, send, abort, toolStatuses };
}
