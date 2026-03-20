import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { initDatabase } from "../../src/main/storage/db.js";
import { SessionManager } from "../../src/main/core/session-manager.js";
import type { UserMessage, AssistantMessage, ToolResultMessage } from "../../src/shared/types.js";
import { NANOID_LENGTH } from "../../src/shared/constants.js";

// --- Helpers ---

function userMsg(content: string, id = "u1"): UserMessage {
  return { role: "user", id, content, ts: Date.now() };
}

function assistantMsg(id = "a1"): AssistantMessage {
  return {
    role: "assistant",
    id,
    api: "openai-chat-completions",
    providerId: "p1",
    modelId: "m1",
    content: [{ type: "text", text: "hello" }],
    stopReason: "stop",
    ts: Date.now(),
  };
}

function toolResultMsg(toolCallId: string, id = "tr1"): ToolResultMessage {
  return {
    role: "toolResult",
    id,
    toolCallId,
    toolName: "bash",
    isError: false,
    content: [{ type: "text", text: "output" }],
    ts: Date.now(),
  };
}

// --- Tests ---

describe("SessionManager", () => {
  let db: Database.Database;
  let mgr: SessionManager;

  beforeEach(() => {
    db = initDatabase(":memory:");
    mgr = new SessionManager(db);
  });

  // 1. create → valid ID, state "idle"
  it("creates a session with valid ID and idle state", () => {
    const id = mgr.create("/tmp/workspace");
    expect(typeof id).toBe("string");
    expect(id.length).toBe(NANOID_LENGTH);
    expect(mgr.getState(id)).toBe("idle");
  });

  // 2. get → returns SessionDetail with messages
  it("returns full session detail with messages", () => {
    const id = mgr.create("/tmp/ws");
    mgr.appendMessage(id, userMsg("hi"));

    const detail = mgr.get(id);
    expect(detail).not.toBeNull();
    expect(detail!.id).toBe(id);
    expect(detail!.workspaceRoot).toBe("/tmp/ws");
    expect(detail!.archived).toBe(false);
    expect(detail!.activeCompactId).toBeNull();
    expect(detail!.pinnedSystemPrompt).toBeNull();
    expect(detail!.settings).toBeNull();
    expect(detail!.messages).toHaveLength(1);
    expect(detail!.messages[0].role).toBe("user");
  });

  it("returns null for non-existent session", () => {
    expect(mgr.get("nonexistent")).toBeNull();
  });

  // 3. list → filtered by archived
  it("lists sessions filtered by archived flag", () => {
    const id1 = mgr.create("/tmp/ws1");
    const id2 = mgr.create("/tmp/ws2");
    mgr.archive(id2);

    const active = mgr.list({ archived: false });
    expect(active).toHaveLength(1);
    expect(active[0].id).toBe(id1);

    const archived = mgr.list({ archived: true });
    expect(archived).toHaveLength(1);
    expect(archived[0].id).toBe(id2);

    const all = mgr.list();
    expect(all).toHaveLength(2);
  });

  // 4. rename
  it("renames a session", () => {
    const id = mgr.create("/tmp/ws");
    mgr.rename(id, "New Title");
    const detail = mgr.get(id);
    expect(detail!.title).toBe("New Title");
  });

  // 5. archive
  it("archives a session and clears runtime", () => {
    const id = mgr.create("/tmp/ws");
    mgr.setState(id, "streaming");
    mgr.archive(id);

    const detail = mgr.get(id);
    expect(detail!.archived).toBe(true);
    // Runtime cleared — state resets to idle on next access
    expect(mgr.getState(id)).toBe("idle");
  });

  it("unarchives a session", () => {
    const id = mgr.create("/tmp/ws");
    mgr.archive(id);

    mgr.unarchive(id);

    const detail = mgr.get(id);
    expect(detail!.archived).toBe(false);
  });

  // 6. delete
  it("deletes a session", () => {
    const id = mgr.create("/tmp/ws");
    mgr.appendMessage(id, userMsg("hi"));
    mgr.delete(id);

    expect(mgr.get(id)).toBeNull();
    expect(mgr.getMessages(id)).toHaveLength(0);
  });

  // 7. appendMessage increments seq
  it("increments seq on each appendMessage", () => {
    const id = mgr.create("/tmp/ws");
    const seq1 = mgr.appendMessage(id, userMsg("first", "u1"));
    const seq2 = mgr.appendMessage(id, assistantMsg("a1"));
    const seq3 = mgr.appendMessage(id, userMsg("second", "u2"));

    expect(seq1).toBe(1);
    expect(seq2).toBe(2);
    expect(seq3).toBe(3);

    const msgs = mgr.getMessages(id);
    expect(msgs).toHaveLength(3);
  });

  it("getMessages supports afterSeq filter", () => {
    const id = mgr.create("/tmp/ws");
    mgr.appendMessage(id, userMsg("first", "u1"));
    mgr.appendMessage(id, assistantMsg("a1"));
    mgr.appendMessage(id, userMsg("second", "u2"));

    const after1 = mgr.getMessages(id, 1);
    expect(after1).toHaveLength(2);
    expect(after1[0].id).toBe("a1");
  });

  it("returns the persisted seq for a message ID", () => {
    const id = mgr.create("/tmp/ws");
    mgr.appendMessage(id, userMsg("first", "u1"));
    mgr.appendMessage(id, assistantMsg("a1"));

    expect(mgr.getMessageSeq(id, "u1")).toBe(1);
    expect(mgr.getMessageSeq(id, "a1")).toBe(2);
    expect(mgr.getMessageSeq(id, "missing")).toBeNull();
  });

  it("updates the session active compact ID", () => {
    const id = mgr.create("/tmp/ws");

    mgr.setActiveCompact(id, "cmp-1");
    expect(mgr.get(id)?.activeCompactId).toBe("cmp-1");

    mgr.setActiveCompact(id, null);
    expect(mgr.get(id)?.activeCompactId).toBeNull();
  });

  // 8. state management
  it("manages session state transitions", () => {
    const id = mgr.create("/tmp/ws");
    expect(mgr.getState(id)).toBe("idle");

    mgr.setState(id, "streaming");
    expect(mgr.getState(id)).toBe("streaming");

    mgr.setState(id, "tooling");
    expect(mgr.getState(id)).toBe("tooling");

    mgr.setState(id, "idle");
    expect(mgr.getState(id)).toBe("idle");
  });

  // 9. abort controller management
  it("manages abort controllers", () => {
    const id = mgr.create("/tmp/ws");
    expect(mgr.getAbortController(id)).toBeNull();

    const ac = new AbortController();
    mgr.setAbortController(id, ac);
    expect(mgr.getAbortController(id)).toBe(ac);

    mgr.clearAbortController(id);
    expect(mgr.getAbortController(id)).toBeNull();
  });

  it("create passes provider and model IDs", () => {
    const id = mgr.create("/tmp/ws", { providerId: "p1", modelId: "m1" });
    const detail = mgr.get(id);
    expect(detail!.activeProviderId).toBe("p1");
    expect(detail!.activeModelId).toBe("m1");
  });
});
