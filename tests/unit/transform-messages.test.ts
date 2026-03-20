import { describe, it, expect } from "vitest";
import {
  transformMessages,
  transformMessagesAnthropic,
  normalizeToolCallId,
} from "../../src/main/provider/transform-messages.js";
import { DEFAULT_COMPAT } from "../../src/main/provider/compat.js";
import type {
  UserMessage,
  AssistantMessage,
  ToolResultMessage,
  ScorelMessage,
} from "../../src/shared/types.js";

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

// --- Anthropic helpers ---

function anthropicAssistantMsg(
  parts: AssistantMessage["content"],
  opts: Partial<Pick<AssistantMessage, "stopReason" | "id" | "modelId">> = {},
): AssistantMessage {
  return {
    role: "assistant",
    id: opts.id ?? "a1",
    api: "anthropic-messages",
    providerId: "p1",
    modelId: opts.modelId ?? "claude-sonnet",
    content: parts,
    stopReason: opts.stopReason ?? "stop",
    ts: Date.now(),
  };
}

describe("transformMessagesAnthropic", () => {
  // 1. Basic user + assistant text turn
  it("converts basic user + assistant text turn", () => {
    const msgs: ScorelMessage[] = [
      userMsg("hello"),
      anthropicAssistantMsg([{ type: "text", text: "hi there" }]),
    ];
    const result = transformMessagesAnthropic("sys", msgs);
    expect(result.messages).toEqual([
      { role: "user", content: [{ type: "text", text: "hello" }] },
      { role: "assistant", content: [{ type: "text", text: "hi there" }] },
    ]);
  });

  // 2. System prompt extracted to top-level
  it("extracts system prompt to top-level", () => {
    const result = transformMessagesAnthropic("You are helpful.", [userMsg("hi")]);
    expect(result.system).toBe("You are helpful.");
    // No system role in messages
    for (const msg of result.messages) {
      expect(msg.role).not.toBe("system");
    }
  });

  // 3. Tool round correctly
  it("converts tool round correctly", () => {
    const msgs: ScorelMessage[] = [
      userMsg("do it"),
      anthropicAssistantMsg(
        [{ type: "toolCall", id: "tc1", name: "bash", arguments: { command: "ls" } }],
        { id: "a1" },
      ),
      toolResultMsg("tc1", "file.txt"),
      anthropicAssistantMsg([{ type: "text", text: "done" }], { id: "a2" }),
    ];
    const result = transformMessagesAnthropic("sys", msgs);
    // user → assistant (tool_use) → user (tool_result) → assistant (text)
    expect(result.messages).toHaveLength(4);
    expect(result.messages[0]).toEqual({
      role: "user",
      content: [{ type: "text", text: "do it" }],
    });
    expect(result.messages[1]).toEqual({
      role: "assistant",
      content: [{ type: "tool_use", id: "tc1", name: "bash", input: { command: "ls" } }],
    });
    expect(result.messages[2]).toEqual({
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "tc1", content: "file.txt" }],
    });
    expect(result.messages[3]).toEqual({
      role: "assistant",
      content: [{ type: "text", text: "done" }],
    });
  });

  // 4. Orders tool_result before text in user message
  it("orders tool_result before text in user message", () => {
    // Simulate a scenario where tool_result and user text merge into same user message:
    // user → assistant(toolCall) → toolResult → user("next") → last two merge as user
    const msgs: ScorelMessage[] = [
      userMsg("go"),
      anthropicAssistantMsg(
        [{ type: "toolCall", id: "tc1", name: "bash", arguments: {} }],
        { id: "a1" },
      ),
      toolResultMsg("tc1", "output"),
      userMsg("next", "u2"),
    ];
    const result = transformMessagesAnthropic("sys", msgs);
    // user → assistant → user(tool_result + text merged)
    const lastUser = result.messages[2];
    expect(lastUser.role).toBe("user");
    expect(lastUser.content[0]).toEqual(
      expect.objectContaining({ type: "tool_result" }),
    );
    expect(lastUser.content[1]).toEqual(
      expect.objectContaining({ type: "text", text: "next" }),
    );
  });

  // 5. Normalizes long tool call IDs
  it("normalizes long tool call IDs", () => {
    const longId = "x".repeat(200);
    const msgs: ScorelMessage[] = [
      userMsg("go"),
      anthropicAssistantMsg(
        [{ type: "toolCall", id: longId, name: "bash", arguments: {} }],
        { id: "a1" },
      ),
      toolResultMsg(longId, "output"),
    ];
    const result = transformMessagesAnthropic("sys", msgs);
    const assistantBlock = result.messages[1].content[0];
    const userBlock = result.messages[2].content[0];

    expect(assistantBlock.type).toBe("tool_use");
    expect(userBlock.type).toBe("tool_result");

    const toolUseId = (assistantBlock as { type: "tool_use"; id: string }).id;
    const toolResultId = (userBlock as { type: "tool_result"; tool_use_id: string }).tool_use_id;

    expect(toolUseId).toBe(toolResultId);
    expect(toolUseId.length).toBeLessThanOrEqual(64);
    expect(toolUseId.startsWith("tc_")).toBe(true);
  });

  // 6. Passes through short IDs unchanged
  it("passes through short IDs unchanged", () => {
    const shortId = "abc123_short";
    const msgs: ScorelMessage[] = [
      userMsg("go"),
      anthropicAssistantMsg(
        [{ type: "toolCall", id: shortId, name: "bash", arguments: {} }],
        { id: "a1" },
      ),
      toolResultMsg(shortId, "output"),
    ];
    const result = transformMessagesAnthropic("sys", msgs);
    const assistantBlock = result.messages[1].content[0] as { type: "tool_use"; id: string };
    expect(assistantBlock.id).toBe(shortId);
  });

  // 7. Excludes aborted assistants
  it("excludes aborted assistants", () => {
    const msgs: ScorelMessage[] = [
      userMsg("hi"),
      anthropicAssistantMsg([{ type: "text", text: "partial" }], { stopReason: "aborted" }),
      userMsg("retry", "u2"),
    ];
    const result = transformMessagesAnthropic("sys", msgs);
    // Two user messages merged into one (alternation)
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].role).toBe("user");
    expect(result.messages[0].content).toHaveLength(2);
  });

  // 8. Excludes orphan tool results
  it("excludes orphan tool results", () => {
    const msgs: ScorelMessage[] = [
      userMsg("go"),
      anthropicAssistantMsg(
        [{ type: "toolCall", id: "tc1", name: "bash", arguments: {} }],
        { stopReason: "aborted", id: "a1" },
      ),
      toolResultMsg("tc1", "orphan"),
      userMsg("retry", "u2"),
    ];
    const result = transformMessagesAnthropic("sys", msgs);
    // aborted assistant and orphan tool result excluded; two users merge
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].role).toBe("user");
    for (const block of result.messages[0].content) {
      expect(block.type).not.toBe("tool_result");
    }
  });

  // 9. Merges consecutive user messages
  it("merges consecutive user messages", () => {
    const msgs: ScorelMessage[] = [userMsg("hello"), userMsg("world", "u2")];
    const result = transformMessagesAnthropic("sys", msgs);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].role).toBe("user");
    expect(result.messages[0].content).toEqual([
      { type: "text", text: "hello" },
      { type: "text", text: "world" },
    ]);
  });

  // 10. Merges consecutive assistant messages
  it("merges consecutive assistant messages", () => {
    const msgs: ScorelMessage[] = [
      userMsg("go"),
      anthropicAssistantMsg([{ type: "text", text: "a" }], { id: "a1" }),
      anthropicAssistantMsg([{ type: "text", text: "b" }], { id: "a2" }),
    ];
    const result = transformMessagesAnthropic("sys", msgs);
    const assistants = result.messages.filter((m) => m.role === "assistant");
    expect(assistants).toHaveLength(1);
    expect(assistants[0].content).toEqual([
      { type: "text", text: "a" },
      { type: "text", text: "b" },
    ]);
  });

  // 11. Preserves thinking for same model
  it("preserves thinking for same model", () => {
    const msgs: ScorelMessage[] = [
      userMsg("think"),
      anthropicAssistantMsg(
        [
          { type: "thinking", thinking: "hmm...", thinkingSignature: "sig123" },
          { type: "text", text: "answer" },
        ],
        { modelId: "claude-sonnet" },
      ),
    ];
    const result = transformMessagesAnthropic("sys", msgs, "claude-sonnet");
    const assistantContent = result.messages[1].content;
    expect(assistantContent[0]).toEqual({
      type: "thinking",
      thinking: "hmm...",
      signature: "sig123",
    });
    expect(assistantContent[1]).toEqual({ type: "text", text: "answer" });
  });

  // 12. Converts thinking to text for different model
  it("converts thinking to text for different model", () => {
    const msgs: ScorelMessage[] = [
      userMsg("think"),
      anthropicAssistantMsg(
        [
          { type: "thinking", thinking: "hmm..." },
          { type: "text", text: "answer" },
        ],
        { modelId: "claude-sonnet" },
      ),
    ];
    const result = transformMessagesAnthropic("sys", msgs, "claude-opus");
    const assistantContent = result.messages[1].content;
    // thinking converted to text
    expect(assistantContent[0]).toEqual({ type: "text", text: "hmm..." });
    expect(assistantContent[1]).toEqual({ type: "text", text: "answer" });
  });

  // 13. Omits redacted thinking
  it("omits redacted thinking", () => {
    const msgs: ScorelMessage[] = [
      userMsg("think"),
      anthropicAssistantMsg(
        [
          { type: "thinking", thinking: "secret", redacted: true },
          { type: "text", text: "answer" },
        ],
        { modelId: "claude-sonnet" },
      ),
    ];
    const result = transformMessagesAnthropic("sys", msgs, "claude-sonnet");
    const assistantContent = result.messages[1].content;
    expect(assistantContent).toEqual([{ type: "text", text: "answer" }]);
  });

  // 14. Handles empty system prompt
  it("handles empty system prompt", () => {
    const result = transformMessagesAnthropic("", [userMsg("hi")]);
    expect(result.system).toBe("");
    expect(result.messages).toHaveLength(1);
  });
});

describe("normalizeToolCallId", () => {
  it("is deterministic", () => {
    const longId = "a".repeat(100);
    expect(normalizeToolCallId(longId)).toBe(normalizeToolCallId(longId));
    expect(normalizeToolCallId(longId)).not.toBe(normalizeToolCallId("b".repeat(100)));
  });

  it("returns exactly 64 chars for long IDs", () => {
    const longId = "x".repeat(200);
    const result = normalizeToolCallId(longId);
    expect(result.length).toBe(64);
  });
});
