import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ProjectAggregator } from "./aggregator.js";

type HeaderInput = {
  sessionId: string;
  createdAt: number;
  meta?: Record<string, unknown>;
};

const writeJsonlSession = (
  sessionsDir: string,
  header: HeaderInput,
  events: Array<Record<string, unknown>> = [],
): void => {
  const path = join(sessionsDir, `${header.sessionId}.jsonl`);
  const headerLine = JSON.stringify({
    version: 1,
    sessionId: header.sessionId,
    deviceId: "device_test",
    createdAt: header.createdAt,
    meta: header.meta ?? {},
  });
  const lines = [headerLine, ...events.map((event) => JSON.stringify(event))];
  writeFileSync(path, `${lines.join("\n")}\n`, "utf8");
};

const event = (id: string, seq: number, sessionId: string): Record<string, unknown> => ({
  type: "user_message",
  id,
  parentId: null,
  seq,
  sessionId,
  clientId: "client_test",
  ts: seq,
  message: { role: "user", content: [{ type: "text", text: id }] },
});

const makeSessionsDir = (): string => mkdtempSync(join(tmpdir(), "scorel-aggregator-"));

describe("ProjectAggregator", () => {
  it("returns empty when sessions directory is missing", async () => {
    const aggregator = new ProjectAggregator({
      sessionsDir: join(tmpdir(), "definitely-does-not-exist-scorel-aggregator"),
      fallbackProjectSlug: "fallback",
    });

    const sessions = await aggregator.listSessions(undefined);
    const projects = await aggregator.listProjects();

    expect(sessions).toEqual([]);
    expect(projects).toEqual([]);
  });

  it("aggregates sessions across distinct projectSlugs and reports DaemonProjectSummary", async () => {
    const sessionsDir = makeSessionsDir();
    writeJsonlSession(
      sessionsDir,
      {
        sessionId: "ses_alpha",
        createdAt: 1,
        meta: {
          projectSlug: "Users-test-alpha",
          workDirHint: "/Users/test/alpha",
          updatedAt: 5,
          model: "model-a",
          title: "Alpha",
        },
      },
      [event("evt_a1", 1, "ses_alpha"), event("evt_a2", 2, "ses_alpha")],
    );
    writeJsonlSession(
      sessionsDir,
      {
        sessionId: "ses_beta",
        createdAt: 2,
        meta: { projectSlug: "Users-test-beta", workDirHint: "/Users/test/beta", updatedAt: 9 },
      },
      [event("evt_b1", 1, "ses_beta")],
    );
    writeJsonlSession(
      sessionsDir,
      {
        sessionId: "ses_alpha2",
        createdAt: 3,
        meta: { projectSlug: "Users-test-alpha", workDirHint: "/Users/test/alpha", updatedAt: 7 },
      },
    );

    const aggregator = new ProjectAggregator({
      sessionsDir,
      fallbackProjectSlug: "Users-test-fallback",
    });

    const projects = await aggregator.listProjects();
    expect(projects.map((project) => project.projectSlug)).toEqual([
      "Users-test-beta",
      "Users-test-alpha",
    ]);
    expect(projects[0]).toMatchObject({
      projectSlug: "Users-test-beta",
      displayName: "beta",
      workDirHint: "/Users/test/beta",
      sessionCount: 1,
      lastSeenAt: 9,
    });
    expect(projects[1]).toMatchObject({
      projectSlug: "Users-test-alpha",
      displayName: "alpha",
      workDirHint: "/Users/test/alpha",
      sessionCount: 2,
      lastSeenAt: 7,
    });

    const allSessions = await aggregator.listSessions(undefined);
    expect(allSessions.map((session) => String(session.sessionId))).toEqual([
      "ses_beta",
      "ses_alpha2",
      "ses_alpha",
    ]);
  });

  it("filters sessions by projectSlug and clamps limit", async () => {
    const sessionsDir = makeSessionsDir();
    for (let i = 0; i < 5; i += 1) {
      writeJsonlSession(sessionsDir, {
        sessionId: `ses_alpha_${i}`,
        createdAt: i,
        meta: { projectSlug: "alpha", workDirHint: "/repo/alpha", updatedAt: 100 + i },
      });
    }
    writeJsonlSession(sessionsDir, {
      sessionId: "ses_beta_0",
      createdAt: 50,
      meta: { projectSlug: "beta", workDirHint: "/repo/beta", updatedAt: 999 },
    });

    const aggregator = new ProjectAggregator({
      sessionsDir,
      fallbackProjectSlug: "fallback",
    });

    const filtered = await aggregator.listSessions({ projectSlug: "alpha" });
    expect(filtered).toHaveLength(5);
    expect(filtered.every((session) => session.projectSlug === "alpha")).toBe(true);
    expect(filtered.map((session) => String(session.sessionId))).toEqual([
      "ses_alpha_4",
      "ses_alpha_3",
      "ses_alpha_2",
      "ses_alpha_1",
      "ses_alpha_0",
    ]);

    const limited = await aggregator.listSessions({ projectSlug: "alpha", limit: 2 });
    expect(limited.map((session) => String(session.sessionId))).toEqual([
      "ses_alpha_4",
      "ses_alpha_3",
    ]);

    const all = await aggregator.listSessions(undefined);
    expect(all[0].projectSlug).toBe("beta");

    const overLimit = await aggregator.listSessions({ limit: 100_000 });
    // 6 sessions in total; clamp doesn't add more.
    expect(overLimit).toHaveLength(6);
  });

  it("falls back to fallbackProjectSlug for legacy headers without meta.projectSlug", async () => {
    const sessionsDir = makeSessionsDir();
    writeJsonlSession(sessionsDir, {
      sessionId: "ses_legacy",
      createdAt: 4,
      meta: { updatedAt: 4 },
    });

    const aggregator = new ProjectAggregator({
      sessionsDir,
      fallbackProjectSlug: "Users-fallback",
      fallbackWorkDirHint: "/Users/fallback",
    });

    const projects = await aggregator.listProjects();
    expect(projects).toHaveLength(1);
    expect(projects[0]).toMatchObject({
      projectSlug: "Users-fallback",
      displayName: "fallback",
      workDirHint: "/Users/fallback",
      sessionCount: 1,
    });
    const sessions = await aggregator.listSessions(undefined);
    expect(sessions[0].projectSlug).toBe("Users-fallback");
  });

  it("derives currentSeq from the tail event seq", async () => {
    const sessionsDir = makeSessionsDir();
    writeJsonlSession(
      sessionsDir,
      { sessionId: "ses_seq", createdAt: 1, meta: { projectSlug: "p", updatedAt: 1 } },
      [event("evt_1", 1, "ses_seq"), event("evt_2", 2, "ses_seq"), event("evt_3", 7, "ses_seq")],
    );

    const aggregator = new ProjectAggregator({ sessionsDir, fallbackProjectSlug: "p" });
    const sessions = await aggregator.listSessions(undefined);
    expect(Number(sessions[0].currentSeq)).toBe(7);
  });

  it("respects in-memory overrides for currentSeq and updatedAt", async () => {
    const sessionsDir = makeSessionsDir();
    writeJsonlSession(sessionsDir, {
      sessionId: "ses_override",
      createdAt: 1,
      meta: { projectSlug: "p", updatedAt: 1 },
    });
    const aggregator = new ProjectAggregator({ sessionsDir, fallbackProjectSlug: "p" });
    const overrides = new Map([
      ["ses_override", { currentSeq: 42, updatedAt: 100 }],
    ]);

    const sessions = await aggregator.listSessions(undefined, overrides);
    expect(Number(sessions[0].currentSeq)).toBe(42);
    expect(sessions[0].updatedAt).toBe(100);

    const projects = await aggregator.listProjects(overrides);
    expect(projects[0].lastSeenAt).toBe(100);
  });

  it("invalidate clears the in-memory cache so new sessions are picked up", async () => {
    const sessionsDir = makeSessionsDir();
    writeJsonlSession(sessionsDir, {
      sessionId: "ses_initial",
      createdAt: 1,
      meta: { projectSlug: "p", updatedAt: 1 },
    });
    const aggregator = new ProjectAggregator({ sessionsDir, fallbackProjectSlug: "p" });
    const before = await aggregator.listSessions(undefined);
    expect(before).toHaveLength(1);

    writeJsonlSession(sessionsDir, {
      sessionId: "ses_after_invalidate",
      createdAt: 2,
      meta: { projectSlug: "p", updatedAt: 2 },
    });

    // Without invalidate the cache returns the stale view.
    const stale = await aggregator.listSessions(undefined);
    expect(stale).toHaveLength(1);

    aggregator.invalidate();
    const fresh = await aggregator.listSessions(undefined);
    expect(fresh).toHaveLength(2);
  });
});
