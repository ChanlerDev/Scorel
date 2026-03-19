import { describe, it, expect } from "vitest";
import { transformMessages } from "../../src/main/provider/transform-messages.js";
import { DEFAULT_COMPAT } from "../../src/main/provider/compat.js";
import type {
  UserMessage,
  AssistantMessage,
  ToolResultMessage,
  ScorelMessage,
} from "../../src/shared/types.js";
import type { OpenAIMessage } from "../../src/main/provider/transform-messages.js";

// --- Helpers ---

function userMsg(content: string, id = "u1"): UserMessage {
  return { role: "user", id, content, ts: Date.now() };
}

function assistantMsg(
  parts: AssistantMessage["content"],
  opts: Partial<Pick<AssistantMessage, "stopReason" | "id">> = {},
): AssistantMessage {
  return {
    role: "assistant",
    id: opts.id ?? "a1",
    api: "openai-chat-completions",
    providerId: "p1",
    modelId: "m1",
    content: parts,
    stopReason: opts.stopReason ?? "stop",
    ts: Date.now(),
  };
}

function toolResultMsg(
  toolCallId: string,
  text: string,
  opts: { toolName?: string; isError?: boolean; id?: string } = {},
): ToolResultMessage {
  return {
    role: "toolResult",
    id: opts.id ?? "tr1",
    toolCallId,
    toolName: opts.toolName ?? "bash",
    isError: opts.isError ?? false,
    content: [{ type: "text", text }],
    ts: Date.now(),
  };
}

const compat = { ...DEFAULT_COMPAT };

describe("transformMessages", () => {
  // 1. Basic user message
  it("converts a user message", () => {
    const result = transformMessages("sys", [userMsg("hello")], compat);
    expect(result).toEqual([
      { role: "system", content: "sys" },
      { role: "user", content: "hello" },
    ]);
  });

  // 2. Assistant text-only → content is string
  it("converts assistant text-only to plain string content", () => {
    const result = transformMessages(
      "",
      [assistantMsg([{ type: "text", text: "line1" }, { type: "text", text: "line2" }])],
      compat,
    );
    // No system message for empty prompt
    expect(result).toEqual([
      { role: "assistant", content: "line1\nline2" },
    ]);
    // Verify content is a string, not an array
    const assistantOut = result[0] as { role: "assistant"; content: string | null };
    expect(typeof assistantOut.content).toBe("string");
  });

  // 3. Assistant with tool calls
  it("converts assistant with tool calls", () => {
    const result = transformMessages(
      "sys",
      [
        assistantMsg([
          { type: "text", text: "thinking..." },
          { type: "toolCall", id: "tc1", name: "bash", arguments: { command: "ls" } },
        ]),
      ],
      compat,
    );
    expect(result).toEqual([
      { role: "system", content: "sys" },
      {
        role: "assistant",
        content: "thinking...",
        tool_calls: [
          {
            id: "tc1",
            type: "function",
            function: { name: "bash", arguments: '{"command":"ls"}' },
          },
        ],
      },
    ]);
  });

  // 4. ToolResult → role "tool"
  it("converts tool result message", () => {
    const msgs: ScorelMessage[] = [
      assistantMsg([{ type: "toolCall", id: "tc1", name: "bash", arguments: {} }]),
      toolResultMsg("tc1", "output"),
    ];
    const result = transformMessages("sys", msgs, compat);
    expect(result[2]).toEqual({
      role: "tool",
      tool_call_id: "tc1",
      content: "output",
    });
  });

  // 5. System prompt as "system" role (default)
  it("uses system role by default", () => {
    const result = transformMessages("prompt", [], compat);
    expect(result[0]).toEqual({ role: "system", content: "prompt" });
  });

  // 6. System prompt as "developer" role
  it("uses developer role when supportsDeveloperRole is true", () => {
    const devCompat = { ...compat, supportsDeveloperRole: true };
    const result = transformMessages("prompt", [], devCompat);
    expect(result[0]).toEqual({ role: "developer", content: "prompt" });
  });

  // 7. Aborted assistant excluded
  it("excludes aborted assistant messages", () => {
    const msgs: ScorelMessage[] = [
      userMsg("hi"),
      assistantMsg([{ type: "text", text: "partial" }], { stopReason: "aborted" }),
      userMsg("retry", "u2"),
    ];
    const result = transformMessages("sys", msgs, compat);
    expect(result).toEqual([
      { role: "system", content: "sys" },
      { role: "user", content: "hi" },
      { role: "user", content: "retry" },
    ]);
  });

  // 8. Orphan toolResult excluded
  it("excludes orphan tool results after aborted assistant", () => {
    const msgs: ScorelMessage[] = [
      userMsg("go"),
      assistantMsg(
        [{ type: "toolCall", id: "tc1", name: "bash", arguments: {} }],
        { stopReason: "aborted", id: "a1" },
      ),
      toolResultMsg("tc1", "orphan output"),
      userMsg("retry", "u2"),
    ];
    const result = transformMessages("sys", msgs, compat);
    // Both aborted assistant and its orphan tool result should be excluded
    expect(result).toEqual([
      { role: "system", content: "sys" },
      { role: "user", content: "go" },
      { role: "user", content: "retry" },
    ]);
  });

  // 9a. ThinkingPart omitted by default
  it("omits thinking parts by default", () => {
    const msgs: ScorelMessage[] = [
      assistantMsg([
        { type: "thinking", thinking: "hmm..." },
        { type: "text", text: "answer" },
      ]),
    ];
    const result = transformMessages("", msgs, compat);
    expect(result).toEqual([{ role: "assistant", content: "answer" }]);
  });

  // 9b. ThinkingPart converted to text when requiresThinkingAsText
  it("converts thinking to text when requiresThinkingAsText is true", () => {
    const thinkCompat = { ...compat, requiresThinkingAsText: true };
    const msgs: ScorelMessage[] = [
      assistantMsg([
        { type: "thinking", thinking: "hmm..." },
        { type: "text", text: "answer" },
      ]),
    ];
    const result = transformMessages("", msgs, thinkCompat);
    expect(result).toEqual([{ role: "assistant", content: "hmm...\nanswer" }]);
  });

  // 9c. Redacted thinking omitted even when requiresThinkingAsText
  it("omits redacted thinking even when requiresThinkingAsText is true", () => {
    const thinkCompat = { ...compat, requiresThinkingAsText: true };
    const msgs: ScorelMessage[] = [
      assistantMsg([
        { type: "thinking", thinking: "secret", redacted: true },
        { type: "text", text: "answer" },
      ]),
    ];
    const result = transformMessages("", msgs, thinkCompat);
    expect(result).toEqual([{ role: "assistant", content: "answer" }]);
  });

  // 10. requiresToolResultName adds name field
  it("adds name to tool messages when requiresToolResultName is true", () => {
    const nameCompat = { ...compat, requiresToolResultName: true };
    const msgs: ScorelMessage[] = [
      assistantMsg([{ type: "toolCall", id: "tc1", name: "read_file", arguments: {} }]),
      toolResultMsg("tc1", "file content", { toolName: "read_file" }),
    ];
    const result = transformMessages("", msgs, nameCompat);
    const toolMsg = result.find((m) => m.role === "tool");
    expect(toolMsg).toEqual({
      role: "tool",
      tool_call_id: "tc1",
      content: "file content",
      name: "read_file",
    });
  });

  // 11. requiresAssistantAfterToolResult inserts bridge message
  it("inserts bridge assistant between tool result and user message", () => {
    const bridgeCompat = { ...compat, requiresAssistantAfterToolResult: true };
    const msgs: ScorelMessage[] = [
      assistantMsg([{ type: "toolCall", id: "tc1", name: "bash", arguments: {} }]),
      toolResultMsg("tc1", "done"),
      userMsg("next"),
    ];
    const result = transformMessages("sys", msgs, bridgeCompat);
    // Expected: system, assistant(toolcall), tool, bridge-assistant, user
    expect(result).toEqual([
      { role: "system", content: "sys" },
      {
        role: "assistant",
        content: null,
        tool_calls: [
          { id: "tc1", type: "function", function: { name: "bash", arguments: "{}" } },
        ],
      },
      { role: "tool", tool_call_id: "tc1", content: "done" },
      { role: "assistant", content: "" },
      { role: "user", content: "next" },
    ]);
  });

  // Edge: assistant with only tool calls → content is null
  it("sets content to null when assistant has no text parts", () => {
    const msgs: ScorelMessage[] = [
      assistantMsg([{ type: "toolCall", id: "tc1", name: "bash", arguments: {} }]),
    ];
    const result = transformMessages("", msgs, compat);
    const a = result[0] as { role: "assistant"; content: string | null };
    expect(a.content).toBeNull();
  });

  // Edge: empty system prompt is omitted
  it("omits system message when prompt is empty", () => {
    const result = transformMessages("", [userMsg("hi")], compat);
    expect(result).toEqual([{ role: "user", content: "hi" }]);
  });

  // Edge: no bridge inserted when tool result is NOT followed by user
  it("does not insert bridge when tool result is followed by assistant", () => {
    const bridgeCompat = { ...compat, requiresAssistantAfterToolResult: true };
    const msgs: ScorelMessage[] = [
      assistantMsg([{ type: "toolCall", id: "tc1", name: "bash", arguments: {} }], { id: "a1" }),
      toolResultMsg("tc1", "done"),
      assistantMsg([{ type: "text", text: "ok" }], { id: "a2" }),
    ];
    const result = transformMessages("", msgs, bridgeCompat);
    // No bridge needed: tool → assistant is fine
    expect(result.filter((m) => m.role === "assistant")).toHaveLength(2);
  });
});
