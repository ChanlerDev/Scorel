import { describe, it, expect, beforeEach } from "vitest";
import { initDatabase } from "../../src/main/storage/db.js";
import { SessionManager } from "../../src/main/core/session-manager.js";
import { EventBus } from "../../src/main/core/event-bus.js";
import { Orchestrator } from "../../src/main/core/orchestrator.js";
import type { ProviderEntry } from "../../src/main/core/orchestrator.js";
import { MockRunner } from "../../src/main/runner/mock-runner.js";
import type {
  AssistantMessage,
  ProviderConfig,
  ToolResultMessage,
  ContentPart,
} from "../../src/shared/types.js";
import type { AssistantMessageEvent, ScorelEvent } from "../../src/shared/events.js";
import type { ProviderAdapter, ProviderRequestOptions } from "../../src/main/provider/types.js";
import type Database from "better-sqlite3";

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

function makeToolCallAssistant(toolCalls: Array<{ id: string; name: string; args: Record<string, unknown> }>): AssistantMessage {
  const content: ContentPart[] = [
    { type: "text", text: "Let me help with that." },
    ...toolCalls.map((tc) => ({
      type: "toolCall" as const,
      id: tc.id,
      name: tc.name,
      arguments: tc.args,
    })),
  ];
  return {
    role: "assistant",
    id: "ast-tc",
    api: "openai-chat-completions",
    providerId: TEST_PROVIDER_ID,
    modelId: TEST_MODEL_ID,
    content,
    stopReason: "toolUse",
    ts: Date.now(),
  };
}

function makeFinalAssistant(text = "Done!"): AssistantMessage {
  return {
    role: "assistant",
    id: "ast-final",
    api: "openai-chat-completions",
    providerId: TEST_PROVIDER_ID,
    modelId: TEST_MODEL_ID,
    content: [{ type: "text", text }],
    stopReason: "stop",
    ts: Date.now(),
  };
}

function createSequentialAdapter(responses: AssistantMessage[]): ProviderAdapter & { callCount: number } {
  let callIndex = 0;
  const adapter: ProviderAdapter & { callCount: number } = {
    api: "openai-chat-completions",
    callCount: 0,
    async stream(
      _config: ProviderConfig,
      _apiKey: string,
      opts: ProviderRequestOptions,
      onEvent: (event: AssistantMessageEvent) => void,
    ): Promise<AssistantMessage> {
      adapter.callCount++;
      const msg = responses[callIndex++];
      if (opts.signal?.aborted) {
        const aborted: AssistantMessage = { ...msg, content: [], stopReason: "aborted" };
        onEvent({ type: "error", reason: "aborted", error: aborted });
        return aborted;
      }
      onEvent({ type: "start", partial: msg });
      onEvent({ type: "done", reason: msg.stopReason, message: msg });
      return msg;
    },
  };
  return adapter;
}

function collectAppEvents(eventBus: EventBus): ScorelEvent[] {
  const events: ScorelEvent[] = [];
  eventBus.onAppEvent((e) => events.push(e));
  return events;
}

describe("Orchestrator — Tool Execution (M2)", () => {
  let db: Database.Database;
  let sessionManager: SessionManager;
  let eventBus: EventBus;
  let mockRunner: MockRunner;

  beforeEach(() => {
    db = initDatabase(":memory:");
    sessionManager = new SessionManager(db);
    eventBus = new EventBus();
    mockRunner = new MockRunner();
  });

  function createOrchestrator(adapter: ProviderAdapter): Orchestrator {
    const providers = new Map<string, ProviderEntry>();
    providers.set(TEST_PROVIDER_ID, {
      config: TEST_PROVIDER_CONFIG,
      adapter,
      getApiKey: async () => "sk-test",
    });
    return new Orchestrator({ db, sessionManager, eventBus, providers, toolRunner: mockRunner });
  }

  function createSession(): string {
    return sessionManager.create("/tmp/workspace", {
      providerId: TEST_PROVIDER_ID,
      modelId: TEST_MODEL_ID,
    });
  }

  // Case B: Complete tool round — tool_calls → approve → execute → re-request → final text
  it("completes full tool round: tool call → approve → execute → final text", async () => {
    const toolCallMsg = makeToolCallAssistant([
      { id: "tc-1", name: "read_file", args: { path: "test.txt" } },
    ]);
    const finalMsg = makeFinalAssistant();
    const adapter = createSequentialAdapter([toolCallMsg, finalMsg]);
    const orch = createOrchestrator(adapter);
    const sessionId = createSession();
    const events = collectAppEvents(eventBus);

    // read_file has approval: "allow", so no approval needed
    await orch.send(sessionId, "Read test.txt");

    const msgs = sessionManager.getMessages(sessionId);
    // user + assistant(toolUse) + toolResult + assistant(final)
    expect(msgs).toHaveLength(4);
    expect(msgs[0].role).toBe("user");
    expect(msgs[1].role).toBe("assistant");
    expect((msgs[1] as AssistantMessage).stopReason).toBe("toolUse");
    expect(msgs[2].role).toBe("toolResult");
    expect(msgs[3].role).toBe("assistant");
    expect((msgs[3] as AssistantMessage).stopReason).toBe("stop");

    // Adapter called twice (first for tool call, second for final)
    expect(adapter.callCount).toBe(2);

    // Tool execution events emitted
    const types = events.map((e) => e.type);
    expect(types).toContain("tool.exec.start");
    expect(types).toContain("tool.exec.end");

    // State returns to idle
    expect(sessionManager.getState(sessionId)).toBe("idle");
  });

  // Case B with approval: bash requires confirm
  it("completes tool round with approval for bash", async () => {
    const toolCallMsg = makeToolCallAssistant([
      { id: "tc-bash", name: "bash", args: { command: "ls" } },
    ]);
    const finalMsg = makeFinalAssistant();
    const adapter = createSequentialAdapter([toolCallMsg, finalMsg]);
    const orch = createOrchestrator(adapter);
    const sessionId = createSession();
    const events = collectAppEvents(eventBus);

    // Start send — it will block on approval
    const sendPromise = orch.send(sessionId, "Run ls");

    // Wait for approval request
    await new Promise((r) => setTimeout(r, 10));

    // Verify awaiting_approval state
    expect(sessionManager.getState(sessionId)).toBe("awaiting_approval");
    expect(events.some((e) => e.type === "approval.requested")).toBe(true);

    // Approve
    orch.approveToolCall("tc-bash");
    await sendPromise;

    const msgs = sessionManager.getMessages(sessionId);
    expect(msgs).toHaveLength(4);
    expect(msgs[2].role).toBe("toolResult");
    expect((msgs[2] as ToolResultMessage).isError).toBe(false);

    // approval.resolved emitted
    expect(events.some((e) => e.type === "approval.resolved")).toBe(true);
  });

  // Case J: Deny tool call → error ToolResultMessage fed back → model adapts
  it("deny tool call produces error result and model continues", async () => {
    const toolCallMsg = makeToolCallAssistant([
      { id: "tc-deny", name: "bash", args: { command: "rm -rf /" } },
    ]);
    const finalMsg = makeFinalAssistant("I understand, I won't do that.");
    const adapter = createSequentialAdapter([toolCallMsg, finalMsg]);
    const orch = createOrchestrator(adapter);
    const sessionId = createSession();

    const sendPromise = orch.send(sessionId, "Delete everything");
    await new Promise((r) => setTimeout(r, 10));

    // Deny
    orch.denyToolCall("tc-deny");
    await sendPromise;

    const msgs = sessionManager.getMessages(sessionId);
    expect(msgs).toHaveLength(4);

    const toolResult = msgs[2] as ToolResultMessage;
    expect(toolResult.role).toBe("toolResult");
    expect(toolResult.isError).toBe(true);
    expect(toolResult.content[0].text).toBe("Tool call denied by user");

    // Model got the denied result and produced final text
    expect(msgs[3].role).toBe("assistant");
    expect((msgs[3] as AssistantMessage).stopReason).toBe("stop");
  });

  // Multiple tool calls with partial deny
  it("handles multiple tool calls with partial deny", async () => {
    const toolCallMsg = makeToolCallAssistant([
      { id: "tc-1", name: "read_file", args: { path: "a.txt" } },
      { id: "tc-2", name: "bash", args: { command: "dangerous" } },
      { id: "tc-3", name: "read_file", args: { path: "b.txt" } },
    ]);
    const finalMsg = makeFinalAssistant();
    const adapter = createSequentialAdapter([toolCallMsg, finalMsg]);
    const orch = createOrchestrator(adapter);
    const sessionId = createSession();

    const sendPromise = orch.send(sessionId, "Do things");
    await new Promise((r) => setTimeout(r, 10));

    // tc-1 (read_file) auto-approved, tc-2 (bash) needs approval
    expect(sessionManager.getState(sessionId)).toBe("awaiting_approval");

    // Deny tc-2
    orch.denyToolCall("tc-2");
    await sendPromise;

    const msgs = sessionManager.getMessages(sessionId);
    // user + assistant(toolUse) + toolResult(tc-1) + toolResult(tc-2 denied) + toolResult(tc-3) + assistant(final)
    expect(msgs).toHaveLength(6);

    const tr1 = msgs[2] as ToolResultMessage;
    expect(tr1.toolCallId).toBe("tc-1");
    expect(tr1.isError).toBe(false);

    const tr2 = msgs[3] as ToolResultMessage;
    expect(tr2.toolCallId).toBe("tc-2");
    expect(tr2.isError).toBe(true);
    expect(tr2.content[0].text).toBe("Tool call denied by user");

    const tr3 = msgs[4] as ToolResultMessage;
    expect(tr3.toolCallId).toBe("tc-3");
    expect(tr3.isError).toBe(false);
  });

  // MockRunner tracks call history
  it("MockRunner records call history", async () => {
    const toolCallMsg = makeToolCallAssistant([
      { id: "tc-r", name: "read_file", args: { path: "hello.txt" } },
    ]);
    const finalMsg = makeFinalAssistant();
    const adapter = createSequentialAdapter([toolCallMsg, finalMsg]);
    const orch = createOrchestrator(adapter);
    const sessionId = createSession();

    await orch.send(sessionId, "Read hello.txt");

    expect(mockRunner.callHistory).toHaveLength(1);
    expect(mockRunner.callHistory[0].toolName).toBe("read_file");
    expect(mockRunner.callHistory[0].args).toEqual({ path: "hello.txt" });
  });

  // No tool runner → tool calls persisted but no execution loop
  it("without toolRunner, tool call assistant is persisted but no execution", async () => {
    const toolCallMsg = makeToolCallAssistant([
      { id: "tc-no", name: "bash", args: { command: "ls" } },
    ]);
    const adapter = createSequentialAdapter([toolCallMsg]);

    const providers = new Map<string, ProviderEntry>();
    providers.set(TEST_PROVIDER_ID, {
      config: TEST_PROVIDER_CONFIG,
      adapter,
      getApiKey: async () => "sk-test",
    });
    const orch = new Orchestrator({ db, sessionManager, eventBus, providers });
    const sessionId = createSession();

    await orch.send(sessionId, "Run ls");

    const msgs = sessionManager.getMessages(sessionId);
    // user + assistant(toolUse) — no tool result, no second call
    expect(msgs).toHaveLength(2);
    expect(adapter.callCount).toBe(1);
  });
});
