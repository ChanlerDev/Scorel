import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import {
  asClientId,
  asDeviceId,
  asEventId,
  asSeq,
  asSessionId,
  type PersistentEvent,
  type SessionMeta,
} from "@scorel/protocol";

import { buildContext, createSession, loadSession, sessionLogFilePath, SessionStoreError } from "./index.js";

const meta: SessionMeta = {
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
        protocolVersion: 1,
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
});
