import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import {
  asClientId,
  asDeviceId,
  asEventId,
  asProjectId,
  asSeq,
  asSessionId,
  type PersistentEvent,
  type QueueItem,
  type SessionMeta,
} from "@scorel/protocol";

import {
  buildContext,
  createSession,
  loadSession,
  sessionLogFilePath,
  SessionStoreError,
} from "./index.js";

const meta: SessionMeta = {
  projectId: asProjectId("prj_test"),
  model: "test-model",
};

const clientId = asClientId("cli_1");
const sessionId = asSessionId("ses_test");
const deviceId = asDeviceId("device_test");

const userEvent = (id: string, parentId: string | null, seq: number, content: string): PersistentEvent => ({
  type: "user_message",
  id: asEventId(id),
  parentId: parentId === null ? null : asEventId(parentId),
  seq: asSeq(seq),
  sessionId,
  clientId,
  ts: 1_000 + seq,
  message: {
    role: "user",
    content: [{ type: "text", text: content }],
  },
});

const assistantEvent = (id: string, parentId: string, seq: number, content: string): PersistentEvent => ({
  type: "assistant_message",
  id: asEventId(id),
  parentId: asEventId(parentId),
  seq: asSeq(seq),
  sessionId,
  clientId,
  ts: 1_000 + seq,
  message: {
    role: "assistant",
    content: [{ type: "text", text: content }],
  },
});

const assistantToolCallEvent = (
  id: string,
  parentId: string,
  seq: number,
  toolCallId: string,
): PersistentEvent => ({
  type: "assistant_message",
  id: asEventId(id),
  parentId: asEventId(parentId),
  seq: asSeq(seq),
  sessionId,
  clientId,
  ts: 1_000 + seq,
  message: {
    role: "assistant",
    stopReason: "tool_call",
    content: [{
      type: "tool_call",
      toolCallId,
      toolName: "Read",
      args: { filePath: "README.md" },
    }],
  },
});

const toolResultEvent = (
  id: string,
  parentId: string,
  seq: number,
  content: string,
  toolCallId = "call_1",
  details?: unknown,
): PersistentEvent => ({
  type: "tool_result",
  id: asEventId(id),
  parentId: asEventId(parentId),
  seq: asSeq(seq),
  sessionId,
  clientId,
  ts: 1_000 + seq,
  message: {
    role: "tool_result",
    content: [
      {
        type: "tool_result",
        toolCallId,
        toolName: "Read",
        result: {
          content: [{ type: "text", text: content }],
          ...(details ? { details } : {}),
        },
      },
    ],
  },
});

const compactEvent = (
  id: string,
  parentId: string,
  seq: number,
  compactedThrough: string,
  summary: string,
  retainedEventCount = 8,
): PersistentEvent => ({
  type: "compact",
  id: asEventId(id),
  parentId: asEventId(parentId),
  seq: asSeq(seq),
  sessionId,
  clientId,
  ts: 1_000 + seq,
  compactedThrough: asEventId(compactedThrough),
  summary,
  tokensBefore: 1000,
  tokensAfter: 250,
  retainedEventCount,
});

const contextControlEvent = (
  id: string,
  seq: number,
  anchorUserEventId: string,
  throughEventId: string,
): PersistentEvent => ({
  type: "context_control",
  id: asEventId(id),
  parentId: null,
  seq: asSeq(seq),
  sessionId,
  clientId,
  ts: 1_000 + seq,
  operation: "hide_user_turn",
  anchorUserEventId: asEventId(anchorUserEventId),
  throughEventId: asEventId(throughEventId),
  actor: "agent",
  reason: "obsolete path",
});

const harnessItemEvent = (
  id: string,
  parentId: string,
  seq: number,
  content: string,
): PersistentEvent => ({
  type: "harness_item",
  id: asEventId(id),
  parentId: asEventId(parentId),
  seq: asSeq(seq),
  sessionId,
  clientId,
  ts: 1_000 + seq,
  item: {
    kind: "steer",
    origin: "user",
    content,
    visibility: "display",
  },
});

const queueUpdateEvent = (id: string, seq: number, items: QueueItem[]): PersistentEvent => ({
  type: "queue_update",
  id: asEventId(id),
  parentId: null,
  seq: asSeq(seq),
  sessionId,
  clientId,
  ts: 1_000 + seq,
  queue: "follow_up",
  operation: "rewrite",
  items,
  anchorEventId: null,
});

const instructionSnapshotEvent = (id: string, seq: number): PersistentEvent => ({
  type: "instruction_snapshot",
  id: asEventId(id),
  parentId: null,
  seq: asSeq(seq),
  sessionId,
  clientId,
  ts: 1_000 + seq,
  snapshot: {
    version: 1,
    cwd: "/repo",
    sections: [
      { kind: "baseline", frozenAt: 1_000, renderedBlock: "base" },
      { kind: "agents", frozenAt: 1_000, renderedBlock: "agents" },
      { kind: "memory", frozenAt: 1_000, renderedBlock: "memory" },
      { kind: "workspace", frozenAt: 1_000, renderedBlock: "workspace" },
      { kind: "environment", frozenAt: 1_000, renderedBlock: "env" },
      { kind: "time", frozenAt: 1_000, renderedBlock: "time" },
    ],
  },
});

const tempRoot = () => mkdtemp(join(tmpdir(), "scorel-session-"));

describe("session core", () => {
  it("derives diagnostics log path beside the session JSONL", async () => {
    const sessionsDir = await tempRoot();

    expect(sessionLogFilePath(sessionsDir, sessionId)).toBe(join(sessionsDir, "ses_test.log"));
  });

  it("creates, appends, closes, reloads, and replays the same session tree", async () => {
    const sessionsDir = await tempRoot();
    const session = await createSession({
      sessionsDir,
      header: {
        version: 1,
        sessionId,
        deviceId,
        createdAt: 1_000,
        meta,
      },
    });

    await session.append(userEvent("evt_1", null, 1, "hello"));
    await session.append(assistantEvent("evt_2", "evt_1", 2, "hi"));
    await session.close();

    const loaded = await loadSession({ sessionsDir, sessionId });

    expect(loaded.header).toEqual(session.header);
    expect([...loaded.tree].map((event) => event.id)).toEqual(["evt_1", "evt_2"]);
    expect(loaded.tree.getPath(asEventId("evt_2"))).toEqual(["evt_1", "evt_2"]);
    expect(loaded.activeLeafId).toBe("evt_2");
    expect(loaded.currentSeq).toBe(2);
    expect(buildContext(loaded.tree, asEventId("evt_2"))).toEqual([
      { role: "user", content: [{ type: "text", text: "hello" }] },
      { role: "assistant", content: [{ type: "text", text: "hi" }] },
    ]);
  });

  it("persists instruction snapshots without adding them to the conversation context", async () => {
    const sessionsDir = await tempRoot();
    const session = await createSession({
      sessionsDir,
      header: {
        version: 1,
        sessionId,
        deviceId,
        createdAt: 1_000,
        meta,
      },
    });

    await session.append(instructionSnapshotEvent("evt_snapshot", 1));
    await session.append(userEvent("evt_1", null, 2, "hello"));
    await session.append(assistantEvent("evt_2", "evt_1", 3, "hi"));

    expect(session.activeLeafId).toBe("evt_2");
    expect(session.tree.controlState.instructionSnapshot?.sections.map((section) => section.kind)).toEqual([
      "baseline",
      "agents",
      "memory",
      "workspace",
      "environment",
      "time",
    ]);
    expect(buildContext(session.tree, asEventId("evt_2")).map((message) => message.role)).toEqual([
      "user",
      "assistant",
    ]);

    const loaded = await loadSession({ sessionsDir, sessionId });
    expect([...loaded.tree].map((event) => event.type)).toEqual([
      "instruction_snapshot",
      "user_message",
      "assistant_message",
    ]);
    expect(loaded.tree.getPath(asEventId("evt_2"))).toEqual(["evt_1", "evt_2"]);
    expect(loaded.tree.controlState.instructionSnapshot?.cwd).toBe("/repo");
  });

  it("converts harness items into system-reminder meta user messages without a tool result", async () => {
    const sessionsDir = await tempRoot();
    const session = await createSession({
      sessionsDir,
      header: {
        version: 1,
        sessionId,
        deviceId,
        createdAt: 1_000,
        meta,
      },
    });

    await session.append(userEvent("evt_1", null, 1, "hello"));
    await session.append(harnessItemEvent("evt_2", "evt_1", 2, "focus on tests"));

    expect(buildContext(session.tree, asEventId("evt_2"))).toEqual([
      { role: "user", content: [{ type: "text", text: "hello" }] },
      {
        role: "user",
        content: [{ type: "text", text: "<system-reminder>\nfocus on tests\n</system-reminder>" }],
        meta: {
          source: "harness_item",
          harnessKind: "steer",
          harnessOrigin: "user",
        },
      },
    ]);
  });

  it("merges harness items into the latest tool result when possible", async () => {
    const sessionsDir = await tempRoot();
    const session = await createSession({
      sessionsDir,
      header: {
        version: 1,
        sessionId,
        deviceId,
        createdAt: 1_000,
        meta,
      },
    });

    await session.append(userEvent("evt_1", null, 1, "hello"));
    await session.append(toolResultEvent("evt_2", "evt_1", 2, "file content"));
    await session.append(harnessItemEvent("evt_3", "evt_2", 3, "do not edit yet"));

    const context = buildContext(session.tree, asEventId("evt_3"));
    expect(context).toHaveLength(2);
    const toolResult = context[1]?.content[0];
    expect(toolResult?.type).toBe("tool_result");
    if (toolResult?.type !== "tool_result") {
      throw new Error("expected tool result");
    }
    expect(toolResult.result).toEqual({
      content: [
        { type: "text", text: "file content" },
        { type: "text", text: "\n\n<system-reminder>\ndo not edit yet\n</system-reminder>" },
      ],
    });
    const original = session.tree.get(asEventId("evt_2"))?.event;
    const expectedOriginal = toolResultEvent("evt_2", "evt_1", 2, "file content");
    expect(original && "message" in original ? original.message : undefined).toEqual(
      "message" in expectedOriginal ? expectedOriginal.message : undefined,
    );
  });

  it("omits tool execution details from rebuilt model context", async () => {
    const sessionsDir = await tempRoot();
    const session = await createSession({
      sessionsDir,
      header: {
        version: 1,
        sessionId,
        deviceId,
        createdAt: 1_000,
        meta,
      },
    });

    const details = { command: "rtk git status", rtk: { applied: true } };
    await session.append(userEvent("evt_1", null, 1, "hello"));
    await session.append(toolResultEvent("evt_2", "evt_1", 2, "clean", "call_1", details));

    const context = buildContext(session.tree, asEventId("evt_2"));
    const toolResult = context[1]?.content[0];
    expect(toolResult?.type).toBe("tool_result");
    if (toolResult?.type !== "tool_result") {
      throw new Error("expected tool result");
    }
    expect(toolResult.result).toEqual({ content: [{ type: "text", text: "clean" }] });
    expect(JSON.stringify(session.tree.get(asEventId("evt_2"))?.event)).toContain("rtk git status");
  });

  it("uses compact events as context barriers while keeping later messages", async () => {
    const sessionsDir = await tempRoot();
    const session = await createSession({
      sessionsDir,
      header: {
        version: 1,
        sessionId,
        deviceId,
        createdAt: 1_000,
        meta,
      },
    });

    await session.append(userEvent("evt_1", null, 1, "old user"));
    await session.append(assistantEvent("evt_2", "evt_1", 2, "old assistant"));
    await session.append(compactEvent("evt_3", "evt_2", 3, "evt_2", "Summary of old context."));
    await session.append(userEvent("evt_4", "evt_3", 4, "recent user"));
    await session.append(assistantEvent("evt_5", "evt_4", 5, "recent assistant"));

    const context = buildContext(session.tree, asEventId("evt_5"));

    expect(context).toEqual([
      {
        role: "user",
        content: [{
          type: "text",
          text: "<system-reminder>\nEarlier session context has been compacted.\n\nSummary of old context.\n\nUse this summary as continuity context. Verify current repository facts before acting.\n</system-reminder>",
        }],
        meta: {
          source: "compact",
          compactedThrough: "evt_2",
        },
      },
      { role: "user", content: [{ type: "text", text: "old user" }] },
      { role: "assistant", content: [{ type: "text", text: "old assistant" }] },
      { role: "user", content: [{ type: "text", text: "recent user" }] },
      { role: "assistant", content: [{ type: "text", text: "recent assistant" }] },
    ]);

    const loaded = await loadSession({ sessionsDir, sessionId });
    expect(loaded.tree.getPath(asEventId("evt_5"))).toEqual(["evt_1", "evt_2", "evt_3", "evt_4", "evt_5"]);
    expect(buildContext(loaded.tree, asEventId("evt_5"))).toHaveLength(5);
  });

  it("retains recent events from a safe boundary before the compact barrier", async () => {
    const sessionsDir = await tempRoot();
    const session = await createSession({
      sessionsDir,
      header: {
        version: 1,
        sessionId,
        deviceId,
        createdAt: 1_000,
        meta,
      },
    });

    await session.append(userEvent("evt_1", null, 1, "old user"));
    await session.append(assistantEvent("evt_2", "evt_1", 2, "old assistant"));
    await session.append(userEvent("evt_3", "evt_2", 3, "latest user before compact"));
    await session.append(assistantEvent("evt_4", "evt_3", 4, "latest assistant before compact"));
    await session.append(toolResultEvent("evt_5", "evt_4", 5, "latest tool result before compact"));
    await session.append(assistantEvent("evt_6", "evt_5", 6, "latest final assistant before compact"));
    await session.append(compactEvent("evt_7", "evt_6", 7, "evt_6", "Summary of older context.", 4));
    await session.append(userEvent("evt_8", "evt_7", 8, "new user after compact"));

    const context = buildContext(session.tree, asEventId("evt_8"));

    expect(context.map((message) => message.role)).toEqual([
      "user",
      "user",
      "assistant",
      "tool_result",
      "assistant",
      "user",
    ]);
    expect(context.map((message) => message.content[0])).toEqual([
      expect.objectContaining({ type: "text", text: expect.stringContaining("Summary of older context.") }),
      { type: "text", text: "latest user before compact" },
      { type: "text", text: "latest assistant before compact" },
      expect.objectContaining({ type: "tool_result" }),
      { type: "text", text: "latest final assistant before compact" },
      { type: "text", text: "new user after compact" },
    ]);
  });

  it("retains the latest replayable tool loop from a long-running turn", async () => {
    const sessionsDir = await tempRoot();
    const session = await createSession({
      sessionsDir,
      header: {
        version: 1,
        sessionId,
        deviceId,
        createdAt: 1_000,
        meta,
      },
    });

    await session.append(userEvent("evt_1", null, 1, "long task"));
    await session.append(assistantToolCallEvent("evt_2", "evt_1", 2, "call_1"));
    await session.append(toolResultEvent("evt_3", "evt_2", 3, "result 1"));
    await session.append(assistantToolCallEvent("evt_4", "evt_3", 4, "call_2"));
    await session.append(toolResultEvent("evt_5", "evt_4", 5, "result 2", "call_2"));
    await session.append(assistantEvent("evt_6", "evt_5", 6, "final answer after tool loop"));
    await session.append(compactEvent("evt_7", "evt_6", 7, "evt_6", "Summary of long task.", 4));
    await session.append(userEvent("evt_8", "evt_7", 8, "continue after compact"));

    const context = buildContext(session.tree, asEventId("evt_8"));

    expect(context.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "tool_result",
      "assistant",
      "user",
    ]);
    expect(context.map((message) => message.content[0])).toEqual([
      expect.objectContaining({ type: "text", text: expect.stringContaining("Summary of long task.") }),
      expect.objectContaining({ type: "tool_call", toolCallId: "call_2" }),
      expect.objectContaining({ type: "tool_result" }),
      { type: "text", text: "final answer after tool loop" },
      { type: "text", text: "continue after compact" },
    ]);
  });

  it("hides a completed user turn from future context while keeping JSONL evidence", async () => {
    const sessionsDir = await tempRoot();
    const session = await createSession({
      sessionsDir,
      header: {
        version: 1,
        sessionId,
        deviceId,
        createdAt: 1_000,
        meta,
      },
    });

    await session.append(userEvent("evt_1", null, 1, "keep setup"));
    await session.append(assistantEvent("evt_2", "evt_1", 2, "setup answer"));
    await session.append(userEvent("evt_3", "evt_2", 3, "obsolete turn"));
    await session.append(assistantEvent("evt_4", "evt_3", 4, "obsolete answer"));
    await session.append(userEvent("evt_5", "evt_4", 5, "continue"));
    await session.append(contextControlEvent("evt_snip", 6, "evt_3", "evt_4"));
    await session.append(assistantEvent("evt_6", "evt_5", 7, "current answer"));

    const context = buildContext(session.tree, asEventId("evt_6"));

    expect(context.map((message) => message.content[0])).toEqual([
      { type: "text", text: "keep setup" },
      { type: "text", text: "setup answer" },
      { type: "text", text: "continue" },
      { type: "text", text: "current answer" },
    ]);
    const loaded = await loadSession({ sessionsDir, sessionId });
    expect(loaded.tree.get(asEventId("evt_3"))?.event).toMatchObject({ type: "user_message" });
    expect(loaded.tree.controlState.hiddenUserTurnSpans).toEqual([
      { anchorUserEventId: "evt_3", throughEventId: "evt_4" },
    ]);
    expect(buildContext(loaded.tree, asEventId("evt_6")).map((message) => message.content[0])).toEqual([
      { type: "text", text: "keep setup" },
      { type: "text", text: "setup answer" },
      { type: "text", text: "continue" },
      { type: "text", text: "current answer" },
    ]);
  });

  it("hides a full tool-using user turn without leaving orphan tool results", async () => {
    const sessionsDir = await tempRoot();
    const session = await createSession({
      sessionsDir,
      header: {
        version: 1,
        sessionId,
        deviceId,
        createdAt: 1_000,
        meta,
      },
    });

    await session.append(userEvent("evt_1", null, 1, "keep"));
    await session.append(assistantEvent("evt_2", "evt_1", 2, "kept answer"));
    await session.append(userEvent("evt_3", "evt_2", 3, "read obsolete file"));
    await session.append(assistantToolCallEvent("evt_4", "evt_3", 4, "call_obsolete"));
    await session.append(toolResultEvent("evt_5", "evt_4", 5, "obsolete result", "call_obsolete"));
    await session.append(assistantEvent("evt_6", "evt_5", 6, "obsolete final"));
    await session.append(userEvent("evt_7", "evt_6", 7, "continue"));
    await session.append(contextControlEvent("evt_snip", 8, "evt_3", "evt_6"));
    await session.append(assistantEvent("evt_8", "evt_7", 9, "current answer"));

    const context = buildContext(session.tree, asEventId("evt_8"));

    expect(context.map((message) => message.role)).toEqual(["user", "assistant", "user", "assistant"]);
    expect(JSON.stringify(context)).not.toContain("call_obsolete");
    expect(JSON.stringify(context)).not.toContain("obsolete result");
  });

  it("keeps snipped turns hidden when compact retains recent events", async () => {
    const sessionsDir = await tempRoot();
    const session = await createSession({
      sessionsDir,
      header: {
        version: 1,
        sessionId,
        deviceId,
        createdAt: 1_000,
        meta,
      },
    });

    await session.append(userEvent("evt_1", null, 1, "keep"));
    await session.append(assistantEvent("evt_2", "evt_1", 2, "kept answer"));
    await session.append(userEvent("evt_3", "evt_2", 3, "obsolete before compact"));
    await session.append(assistantEvent("evt_4", "evt_3", 4, "obsolete compact-retained answer"));
    await session.append(userEvent("evt_5", "evt_4", 5, "continue"));
    await session.append(contextControlEvent("evt_snip", 6, "evt_3", "evt_4"));
    await session.append(compactEvent("evt_6", "evt_5", 7, "evt_5", "Summary.", 4));
    await session.append(userEvent("evt_7", "evt_6", 8, "after compact"));

    const context = buildContext(session.tree, asEventId("evt_7"));

    expect(JSON.stringify(context)).toContain("Summary.");
    expect(JSON.stringify(context)).toContain("continue");
    expect(JSON.stringify(context)).not.toContain("obsolete before compact");
    expect(JSON.stringify(context)).not.toContain("obsolete compact-retained answer");
  });

  it("replays queue updates as control state outside the conversation tree", async () => {
    const sessionsDir = await tempRoot();
    const session = await createSession({
      sessionsDir,
      header: {
        version: 1,
        sessionId,
        deviceId,
        createdAt: 1_000,
        meta,
      },
    });
    const item = {
      id: "queue_1",
      content: [{ type: "text" as const, text: "next" }],
      createdAt: 1_000,
      updatedAt: 1_000,
      clientId,
    };

    await session.append(userEvent("evt_1", null, 1, "hello"));
    await session.append(queueUpdateEvent("evt_queue", 2, [item]));
    await session.append(assistantEvent("evt_2", "evt_1", 3, "hi"));

    expect(session.tree.getLeaves()).toEqual(["evt_2"]);
    expect(session.tree.controlState.queues.follow_up).toEqual([item]);
    expect(buildContext(session.tree, asEventId("evt_2")).map((message) => message.role)).toEqual([
      "user",
      "assistant",
    ]);

    const loaded = await loadSession({ sessionsDir, sessionId });
    expect(loaded.tree.controlState.queues.follow_up).toEqual([item]);
    expect(loaded.tree.getPath(asEventId("evt_2"))).toEqual(["evt_1", "evt_2"]);
  });

  it("replays skill index snapshot and delta into session control state", async () => {
    const sessionsDir = await tempRoot();
    const session = await createSession({
      sessionsDir,
      header: {
        version: 1,
        sessionId,
        deviceId,
        createdAt: 1_000,
        meta,
      },
    });
    const verifyEntry = {
      name: "verify",
      path: "/repo/.scorel/skills/verify/SKILL.md",
      scope: "project" as const,
      description: "Run checks",
      mtimeMs: 1,
      size: 10,
      contentHash: "hash1",
      priority: 100,
    };
    const commitEntry = {
      ...verifyEntry,
      name: "commit",
      path: "/repo/.scorel/skills/commit/SKILL.md",
      description: "Commit changes",
      contentHash: "hash2",
    };

    await session.append({
      type: "skill_index_snapshot",
      id: asEventId("evt_skills_1"),
      parentId: null,
      seq: asSeq(1),
      sessionId,
      clientId,
      ts: 1_001,
      anchorEventId: null,
      entries: [verifyEntry],
    });
    await session.append({
      type: "skill_index_delta",
      id: asEventId("evt_skills_2"),
      parentId: null,
      seq: asSeq(2),
      sessionId,
      clientId,
      ts: 1_002,
      anchorEventId: null,
      added: [commitEntry],
      changed: [],
      removed: [{ name: "verify", previousPath: verifyEntry.path }],
    });

    expect(Object.keys(session.tree.controlState.skillIndex).sort()).toEqual(["commit"]);
    const loaded = await loadSession({ sessionsDir, sessionId });
    expect(loaded.tree.controlState.skillIndexInitialized).toBe(true);
    expect(Object.keys(loaded.tree.controlState.skillIndex)).toEqual(["commit"]);
  });

  it("tracks branch leaves and builds context for the selected leaf", async () => {
    const sessionsDir = await tempRoot();
    const session = await createSession({
      sessionsDir,
      header: {
        version: 1,
        sessionId,
        deviceId,
        createdAt: 1_000,
        meta,
      },
    });

    await session.append(userEvent("evt_1", null, 1, "root"));
    await session.append(assistantEvent("evt_2", "evt_1", 2, "first branch"));
    await session.append(assistantEvent("evt_3", "evt_1", 3, "second branch"));

    expect(session.tree.getLeaves()).toEqual(["evt_2", "evt_3"]);
    expect(session.tree.getBranchPoints()).toEqual(["evt_1"]);
    expect(buildContext(session.tree, asEventId("evt_3")).map((message) => message.content[0])).toEqual([
      { type: "text", text: "root" },
      { type: "text", text: "second branch" },
    ]);
  });

  it("fails predictably for missing header, invalid JSON, duplicate ids, invalid parents, and non-monotonic seq", async () => {
    const sessionsDir = await tempRoot();
    await writeFile(join(sessionsDir, "missing.jsonl"), "");
    await expect(loadSession({ filePath: join(sessionsDir, "missing.jsonl") })).rejects.toMatchObject({
      code: "missing_header",
    });

    await writeFile(join(sessionsDir, "invalid-json.jsonl"), '{"version":1}\n{nope}\n');
    await expect(loadSession({ filePath: join(sessionsDir, "invalid-json.jsonl") })).rejects.toMatchObject({
      code: "invalid_json",
      line: 2,
    });

    const session = await createSession({
      sessionsDir,
      header: {
        version: 1,
        sessionId,
        deviceId,
        createdAt: 1_000,
        meta,
      },
    });

    await session.append(userEvent("evt_1", null, 1, "hello"));
    await expect(
      session.append({
        type: "session_header",
        protocolVersion: 4,
        id: asEventId("evt_header"),
        parentId: asEventId("evt_1"),
        seq: asSeq(2),
        sessionId,
        clientId,
        ts: 1_002,
        meta,
      }),
    ).rejects.toMatchObject({
      code: "invalid_event",
    });
    await expect(session.append(assistantEvent("evt_1", "evt_1", 2, "duplicate"))).rejects.toBeInstanceOf(
      SessionStoreError,
    );
    await expect(session.append(assistantEvent("evt_2", "missing", 3, "orphan"))).rejects.toMatchObject({
      code: "invalid_parent",
    });
    await expect(session.append(assistantEvent("evt_3", "evt_1", 1, "old seq"))).rejects.toMatchObject({
      code: "non_monotonic_seq",
    });
  });

  it("stores title update events as metadata outside the conversation tree", async () => {
    const sessionsDir = await tempRoot();
    const session = await createSession({
      sessionsDir,
      header: {
        version: 1,
        sessionId,
        deviceId,
        createdAt: 1_000,
        meta,
      },
    });
    await session.append(userEvent("evt_1", null, 1, "hello"));
    await session.append({
      type: "session_title_updated",
      id: asEventId("evt_title"),
      parentId: null,
      seq: asSeq(2),
      sessionId,
      clientId,
      ts: 1_002,
      title: "Hello Session",
      source: "user",
    });

    const loaded = await loadSession({ filePath: session.filePath });
    expect(loaded.currentSeq).toBe(2);
    expect(loaded.activeLeafId).toBe("evt_1");
    expect([...loaded.tree].map((event) => event.type)).toEqual(["user_message", "session_title_updated"]);
  });

  it("rejects pre-S0048 headers without meta.projectId", async () => {
    const sessionsDir = await tempRoot();
    await writeFile(
      join(sessionsDir, "legacy.jsonl"),
      `${JSON.stringify({
        version: 1,
        sessionId: "ses_legacy",
        deviceId: "device_test",
        createdAt: 1_000,
        meta: { ["project" + "Slug"]: "legacy" },
      })}\n`,
    );

    await expect(loadSession({ filePath: join(sessionsDir, "legacy.jsonl") })).rejects.toMatchObject({
      code: "invalid_header",
      message: "Session header is missing meta.projectId",
    });
  });
});
