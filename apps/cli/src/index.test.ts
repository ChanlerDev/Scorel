import { describe, expect, it } from "vitest";
import { formatHistory, formatRuntimeEvent, parseCliArgs, parsePromptCommand, readPromptFromArgsOrStdin } from "./index.js";
import type { AssistantMessage } from "@scorel/core/llm";

function assistantMessage(text: string, timestamp: number): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    api: "openai-responses",
    provider: "openai",
    model: "test",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
    },
    stopReason: "stop",
    timestamp
  };
}

describe("readPromptFromArgsOrStdin", () => {
  it("uses command line arguments when provided", async () => {
    await expect(readPromptFromArgsOrStdin(["hello", "world"], async () => "ignored")).resolves.toBe(
      "hello world"
    );
  });

  it("falls back to stdin when no arguments are provided", async () => {
    await expect(readPromptFromArgsOrStdin([], async () => "from stdin\n")).resolves.toBe("from stdin");
  });

  it("parses session flags separately from prompt text", () => {
    expect(parseCliArgs(["--session", "abc123", "hello", "world"])).toEqual({
      promptArgs: ["hello", "world"],
      sessionId: "abc123",
      newSession: false,
      resumeLatest: false
    });

    expect(parseCliArgs(["--new", "hello"])).toEqual({
      promptArgs: ["hello"],
      sessionId: undefined,
      newSession: true,
      resumeLatest: false
    });

    expect(parseCliArgs(["--", "--new", "hello"])).toEqual({
      promptArgs: ["hello"],
      sessionId: undefined,
      newSession: true,
      resumeLatest: false
    });

    expect(parseCliArgs(["--resume", "hello"])).toEqual({
      promptArgs: ["hello"],
      sessionId: undefined,
      newSession: false,
      resumeLatest: true
    });
  });

  it("rejects a missing session id", () => {
    expect(() => parseCliArgs(["--session"])).toThrow("--session requires a session id");
  });

  it("parses slash commands separately from model prompts", () => {
    expect(parsePromptCommand("/history")).toEqual({ type: "history" });
    expect(parsePromptCommand("/rewind msg-1")).toEqual({ type: "rewind", targetMessageId: "msg-1" });
    expect(parsePromptCommand("/fork msg-1")).toEqual({ type: "fork", targetMessageId: "msg-1" });
    expect(parsePromptCommand("hello /history")).toEqual({ type: "prompt", prompt: "hello /history" });
  });

  it("rejects slash commands that require a message id", () => {
    expect(() => parsePromptCommand("/rewind")).toThrow("/rewind requires a message id");
    expect(() => parsePromptCommand("/fork")).toThrow("/fork requires a message id");
  });

  it("formats history with message ids and rewindable boundaries", () => {
    expect(
      formatHistory([
        {
          id: "msg-1",
          at: 1,
          rewindable: true,
          message: { role: "user", content: "first prompt", timestamp: 1 }
        },
        {
          id: "msg-2",
          at: 2,
          rewindable: false,
          message: assistantMessage("assistant response", 2)
        }
      ])
    ).toBe("msg-1 * user first prompt\nmsg-2 - assistant assistant response\n");
  });

  it("formats tool execution and runtime error events for stderr", () => {
    expect(
      formatRuntimeEvent({
        type: "tool_execution_start",
        sessionId: "test",
        toolCallId: "call_1",
        toolName: "read",
        args: { path: "package.json" }
      })
    ).toEqual([{ stream: "stderr", text: "[tool:start] read call_1\n" }]);

    expect(
      formatRuntimeEvent({
        type: "runtime_end",
        sessionId: "test",
        error: "provider failed"
      })
    ).toEqual([{ stream: "stderr", text: "[runtime:error] provider failed\n" }]);
  });
});
