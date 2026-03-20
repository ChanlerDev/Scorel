import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type Database from "better-sqlite3";
import { initDatabase, createSession as dbCreateSession, insertMessage } from "../../src/main/storage/db.js";
import { insertCompaction, updateSessionCompact } from "../../src/main/storage/compactions.js";
import { SessionManager } from "../../src/main/core/session-manager.js";
import { EventBus } from "../../src/main/core/event-bus.js";
import { Orchestrator } from "../../src/main/core/orchestrator.js";
import type { ProviderEntry } from "../../src/main/core/orchestrator.js";
import { getCompaction } from "../../src/main/storage/compactions.js";
import type {
  AssistantMessage,
  ProviderConfig,
  SkillMeta,
} from "../../src/shared/types.js";
import type { AssistantMessageEvent } from "../../src/shared/events.js";
import type { ProviderAdapter, ProviderRequestOptions } from "../../src/main/provider/types.js";

const TEST_PROVIDER_ID = "test-provider";
const TEST_MODEL_ID = "test-model";

const TEST_PROVIDER_CONFIG: ProviderConfig = {
  id: TEST_PROVIDER_ID,
  displayName: "Test Provider",
  api: "openai-chat-completions",
  baseUrl: "https://api.test.com",
  auth: { type: "bearer", keyRef: "test-key" },
  models: [{ id: TEST_MODEL_ID, displayName: "Test Model" }],
};

function assistantTextMessage(id: string, text: string): AssistantMessage {
  return {
    role: "assistant",
    id,
    api: "openai-chat-completions",
    providerId: TEST_PROVIDER_ID,
    modelId: TEST_MODEL_ID,
    content: [{ type: "text", text }],
    stopReason: "stop",
    ts: Date.now(),
  };
}

function assistantLoadSkillMessage(): AssistantMessage {
  return {
    role: "assistant",
    id: "assistant-load-skill",
    api: "openai-chat-completions",
    providerId: TEST_PROVIDER_ID,
    modelId: TEST_MODEL_ID,
    content: [
      { type: "text", text: "I should load the skill." },
      {
        type: "toolCall",
        id: "skill-call-1",
        name: "load_skill",
        arguments: { name: "code-review" },
      },
    ],
    stopReason: "toolUse",
    ts: Date.now(),
  };
}

function assistantUnknownSkillMessage(): AssistantMessage {
  return {
    role: "assistant",
    id: "assistant-unknown-skill",
    api: "openai-chat-completions",
    providerId: TEST_PROVIDER_ID,
    modelId: TEST_MODEL_ID,
    content: [
      { type: "text", text: "I should load the missing skill." },
      {
        type: "toolCall",
        id: "skill-call-missing",
        name: "load_skill",
        arguments: { name: "missing-skill" },
      },
    ],
    stopReason: "toolUse",
    ts: Date.now(),
  };
}

function createSequentialAdapter(responses: AssistantMessage[]) {
  const requests: ProviderRequestOptions[] = [];
  let index = 0;

  const adapter: ProviderAdapter = {
    api: "openai-chat-completions",
    async stream(
      _config: ProviderConfig,
      _apiKey: string,
      opts: ProviderRequestOptions,
      onEvent: (event: AssistantMessageEvent) => void,
    ): Promise<AssistantMessage> {
      requests.push({
        ...opts,
        messages: opts.messages.map((message) => JSON.parse(JSON.stringify(message))),
      });
      const message = responses[index++];
      onEvent({ type: "start", partial: message });
      onEvent({ type: "done", reason: message.stopReason, message });
      return message;
    },
  };

  return { adapter, requests };
}

describe("Orchestrator M4", () => {
  let db: Database.Database;
  let sessionManager: SessionManager;
  let eventBus: EventBus;
  let skillsDir: string;
  let transcriptDir: string;

  beforeEach(() => {
    db = initDatabase(":memory:");
    sessionManager = new SessionManager(db);
    eventBus = new EventBus();
    skillsDir = path.join(os.tmpdir(), `scorel-m4-skills-${Date.now()}`);
    transcriptDir = path.join(os.tmpdir(), `scorel-m4-transcripts-${Date.now()}`);
    mkdirSync(skillsDir, { recursive: true });
    mkdirSync(transcriptDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(skillsDir, { recursive: true, force: true });
    rmSync(transcriptDir, { recursive: true, force: true });
  });

  function createSession(): string {
    return sessionManager.create("/tmp/workspace", {
      providerId: TEST_PROVIDER_ID,
      modelId: TEST_MODEL_ID,
    });
  }

  function createProviderEntry(adapter: ProviderAdapter): ProviderEntry {
    return {
      config: TEST_PROVIDER_CONFIG,
      adapter,
      getApiKey: async () => "sk-test",
    };
  }

  it("manualCompact stores summary and future context resumes from the boundary", async () => {
    const summaryMessage = assistantTextMessage(
      "summary-response",
      "Decision: update src/auth.ts. Status: implementation pending.",
    );
    const finalReply = assistantTextMessage("final-response", "Continuing from the compacted summary.");
    const { adapter, requests } = createSequentialAdapter([summaryMessage, finalReply]);
    const providers = new Map<string, ProviderEntry>();
    providers.set(TEST_PROVIDER_ID, createProviderEntry(adapter));

    const orchestrator = new Orchestrator({
      db,
      sessionManager,
      eventBus,
      providers,
      skills: [],
      compactTranscriptDir: transcriptDir,
    });

    const sessionId = createSession();
    sessionManager.appendMessage(sessionId, {
      role: "user",
      id: "u1",
      content: "Investigate the auth bug",
      ts: 100,
    });
    sessionManager.appendMessage(sessionId, {
      role: "assistant",
      id: "a1",
      api: "openai-chat-completions",
      providerId: TEST_PROVIDER_ID,
      modelId: TEST_MODEL_ID,
      content: [{ type: "text", text: "The bug is in src/auth.ts." }],
      stopReason: "stop",
      ts: 101,
    });

    const compactResult = await orchestrator.manualCompact(sessionId);

    expect(compactResult.summaryText).toContain("src/auth.ts");
    expect(sessionManager.get(sessionId)?.activeCompactId).toBe(compactResult.compactionId);
    expect(getCompaction(db, compactResult.compactionId)?.boundaryMessageId).toBe("a1");

    await orchestrator.send(sessionId, "Continue with the implementation");

    const resumedRequest = requests[1];
    expect(resumedRequest.messages).toHaveLength(2);
    expect(resumedRequest.messages[0]).toMatchObject({
      role: "user",
      content: expect.stringContaining("src/auth.ts"),
    });
    expect(resumedRequest.messages[1]).toMatchObject({
      role: "user",
      content: "Continue with the implementation",
    });
  });

  it("resumes from post-boundary messages using DB seq instead of array position", async () => {
    const { adapter, requests } = createSequentialAdapter([
      assistantTextMessage("final-response", "Continuing after a compact with sparse seq values."),
    ]);
    const providers = new Map<string, ProviderEntry>();
    providers.set(TEST_PROVIDER_ID, createProviderEntry(adapter));

    const orchestrator = new Orchestrator({
      db,
      sessionManager,
      eventBus,
      providers,
      skills: [],
    });

    dbCreateSession(db, {
      id: "session-gap",
      workspaceRoot: "/tmp/workspace",
      providerId: TEST_PROVIDER_ID,
      modelId: TEST_MODEL_ID,
    });
    insertMessage(db, "session-gap", 10, {
      role: "user",
      id: "u-old",
      content: "Old request",
      ts: 100,
    });
    insertMessage(db, "session-gap", 20, {
      role: "assistant",
      id: "a-boundary",
      api: "openai-chat-completions",
      providerId: TEST_PROVIDER_ID,
      modelId: TEST_MODEL_ID,
      content: [{ type: "text", text: "Boundary answer" }],
      stopReason: "stop",
      ts: 101,
    });
    insertMessage(db, "session-gap", 30, {
      role: "user",
      id: "u-new",
      content: "Post-boundary user message",
      ts: 102,
    });

    insertCompaction(db, {
      id: "cmp-gap",
      sessionId: "session-gap",
      boundaryMessageId: "a-boundary",
      summaryText: "Summary before the sparse boundary",
      providerId: TEST_PROVIDER_ID,
      modelId: TEST_MODEL_ID,
      transcriptPath: null,
      createdAt: 103,
    });
    updateSessionCompact(db, "session-gap", "cmp-gap");

    await orchestrator.send("session-gap", "Continue after sparse seq compact");

    const resumedRequest = requests[0];
    expect(resumedRequest.messages).toHaveLength(3);
    expect(resumedRequest.messages[0]).toMatchObject({
      role: "user",
      content: expect.stringContaining("Summary before the sparse boundary"),
    });
    expect(resumedRequest.messages[1]).toMatchObject({
      role: "user",
      id: "u-new",
      content: "Post-boundary user message",
    });
    expect(resumedRequest.messages[2]).toMatchObject({
      role: "user",
      content: "Continue after sparse seq compact",
    });
  });

  it("executes load_skill without a runner and persists the tool result", async () => {
    const skillContent = [
      "---",
      "name: code-review",
      "description: Review code changes",
      'version: "1.0"',
      "---",
      "",
      "# Code Review",
      "Use read_file before making changes.",
    ].join("\n");
    const skillPath = path.join(skillsDir, "code-review.md");
    writeFileSync(skillPath, skillContent);

    const skills: SkillMeta[] = [{
      name: "code-review",
      description: "Review code changes",
      version: "1.0",
      filePath: skillPath,
    }];

    const { adapter } = createSequentialAdapter([
      assistantLoadSkillMessage(),
      assistantTextMessage("final-response", "Loaded the skill and will follow it."),
    ]);
    const providers = new Map<string, ProviderEntry>();
    providers.set(TEST_PROVIDER_ID, createProviderEntry(adapter));

    const orchestrator = new Orchestrator({
      db,
      sessionManager,
      eventBus,
      providers,
      skills,
    });

    const sessionId = createSession();
    await orchestrator.send(sessionId, "Please review this change");

    const messages = sessionManager.getMessages(sessionId);
    expect(messages).toHaveLength(4);
    expect(messages[2]).toMatchObject({
      role: "toolResult",
      toolName: "load_skill",
      isError: false,
    });
    expect(messages[2].content[0].text).toContain("# Code Review");
    expect(messages[3]).toMatchObject({
      role: "assistant",
      stopReason: "stop",
    });
  });

  it("returns an error tool result when load_skill requests an unknown skill", async () => {
    const { adapter } = createSequentialAdapter([
      assistantUnknownSkillMessage(),
      assistantTextMessage("final-response", "The requested skill does not exist."),
    ]);
    const providers = new Map<string, ProviderEntry>();
    providers.set(TEST_PROVIDER_ID, createProviderEntry(adapter));

    const orchestrator = new Orchestrator({
      db,
      sessionManager,
      eventBus,
      providers,
      skills: [],
    });

    const sessionId = createSession();
    await orchestrator.send(sessionId, "Load a missing skill");

    const messages = sessionManager.getMessages(sessionId);
    expect(messages[2]).toMatchObject({
      role: "toolResult",
      toolName: "load_skill",
      isError: true,
    });
    expect(messages[2].content[0].text).toBe("Unknown skill: missing-skill");
  });

  it("emits compact.failed and restores idle state when manual compact fails", async () => {
    const failingAdapter: ProviderAdapter = {
      api: "openai-chat-completions",
      async stream() {
        throw new Error("summary request failed");
      },
    };
    const providers = new Map<string, ProviderEntry>();
    providers.set(TEST_PROVIDER_ID, createProviderEntry(failingAdapter));

    const orchestrator = new Orchestrator({
      db,
      sessionManager,
      eventBus,
      providers,
      skills: [],
    });

    const sessionId = createSession();
    sessionManager.appendMessage(sessionId, {
      role: "user",
      id: "u1",
      content: "Compact this later",
      ts: 100,
    });

    const events: string[] = [];
    eventBus.onAppEvent((event) => {
      if ("sessionId" in event && event.sessionId === sessionId) {
        events.push(event.type);
      }
    });

    await expect(orchestrator.manualCompact(sessionId)).rejects.toThrow("summary request failed");
    expect(sessionManager.getState(sessionId)).toBe("idle");
    expect(events).toContain("compact.failed");
    expect(sessionManager.get(sessionId)?.activeCompactId).toBeNull();
  });
});
