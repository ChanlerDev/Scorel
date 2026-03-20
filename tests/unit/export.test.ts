import { describe, it, expect, beforeEach } from "vitest";
import type Database from "better-sqlite3";
import { initDatabase } from "../../src/main/storage/db.js";
import { SessionManager } from "../../src/main/core/session-manager.js";
import { EXPORT_VERSION } from "../../src/shared/constants.js";
import type { AssistantMessage, ToolResultMessage, UserMessage } from "../../src/shared/types.js";

function userMessage(content: string, id: string, ts: number): UserMessage {
  return { role: "user", id, content, ts };
}

function assistantMessage(id: string, ts: number): AssistantMessage {
  return {
    role: "assistant",
    id,
    api: "openai-chat-completions",
    providerId: "provider-1",
    modelId: "model-1",
    content: [
      { type: "text", text: "Answer with secret sk-12345678901234567890 in /Users/chanler/workspace" },
      { type: "thinking", thinking: "internal reasoning" },
      {
        type: "toolCall",
        id: "tool-1",
        name: "bash",
        arguments: { command: "printf 'Bearer abc.def'" },
      },
    ],
    stopReason: "toolUse",
    ts,
  };
}

function toolResultMessage(id: string, ts: number): ToolResultMessage {
  return {
    role: "toolResult",
    id,
    toolCallId: "tool-1",
    toolName: "bash",
    isError: false,
    content: [{ type: "text", text: `${"x".repeat(550)} /Users/chanler/tmp Bearer xyz` }],
    ts,
  };
}

describe("SessionManager exports", () => {
  let db: Database.Database;
  let manager: SessionManager;
  let sessionId: string;

  beforeEach(() => {
    db = initDatabase(":memory:");
    manager = new SessionManager(db);
    sessionId = manager.create("/Users/chanler/project", {
      providerId: "provider-1",
      modelId: "model-1",
    });
    manager.rename(sessionId, "Export Session");
    manager.appendMessage(sessionId, userMessage("show export behavior", "u1", 100));
    manager.appendMessage(sessionId, assistantMessage("a1", 101));
    manager.appendMessage(sessionId, toolResultMessage("tr1", 102));
  });

  it("exports re-importable JSONL with a session header and full messages", () => {
    const lines = manager.exportJsonl(sessionId).trim().split("\n");

    expect(lines).toHaveLength(4);

    const header = JSON.parse(lines[0]) as {
      v: string;
      type: string;
      session: { id: string; title: string | null; activeProviderId: string | null };
    };
    expect(header).toMatchObject({
      v: EXPORT_VERSION,
      type: "session",
      session: {
        id: sessionId,
        title: "Export Session",
        activeProviderId: "provider-1",
      },
    });

    const messageLine = JSON.parse(lines[2]) as {
      v: string;
      type: string;
      seq: number;
      message: AssistantMessage;
    };
    expect(messageLine.v).toBe(EXPORT_VERSION);
    expect(messageLine.type).toBe("message");
    expect(messageLine.seq).toBe(2);
    expect(messageLine.message.content[2]).toMatchObject({
      type: "toolCall",
      name: "bash",
    });
  });

  it("redacts secrets and home paths in JSONL exports", () => {
    const exported = manager.exportJsonl(sessionId, { redact: true });

    expect(exported).not.toContain("sk-12345678901234567890");
    expect(exported).toContain("sk-***REDACTED***");
    expect(exported).not.toContain("Bearer abc.def");
    expect(exported).toContain("Bearer ***REDACTED***");
    expect(exported).not.toContain("/Users/chanler/project");
    expect(exported).toContain("~/project");
  });

  it("exports readable markdown with blockquoted tool calls and truncated tool results", () => {
    const exported = manager.exportMarkdown(sessionId, { redact: true });

    expect(exported).toContain("# Session: Export Session");
    expect(exported).toContain("## User");
    expect(exported).toContain("## Assistant");
    expect(exported).toContain("<details>");
    expect(exported).toContain("> **Tool Call**: bash");
    expect(exported).toContain("> ```json");
    expect(exported).toContain("## Tool Result: bash");
    expect(exported).toContain("... (truncated)");
    expect(exported).not.toContain("/Users/chanler/tmp");
    expect(exported).toContain("~/workspace");
  });
});
