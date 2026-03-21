import { describe, it, expect, beforeEach, vi } from "vitest";
import { initDatabase } from "../../src/main/storage/db.js";
import { SessionManager } from "../../src/main/core/session-manager.js";
import { EventBus } from "../../src/main/core/event-bus.js";
import { Orchestrator } from "../../src/main/core/orchestrator.js";
import type { ProviderEntry } from "../../src/main/core/orchestrator.js";
import type {
  AssistantMessage,
  ProviderConfig,
  ContentPart,
} from "../../src/shared/types.js";
import type { AssistantMessageEvent, ScorelEvent } from "../../src/shared/events.js";
import type { ProviderAdapter, ProviderRequestOptions } from "../../src/main/provider/types.js";
import type { ToolRunner } from "../../src/main/runner/runner-protocol.js";
import type Database from "better-sqlite3";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function makeAssistantMessage(overrides?: Partial<AssistantMessage>): AssistantMessage {
  return {
    role: "assistant",
    id: "ast-1",
    api: "openai-chat-completions",
    providerId: TEST_PROVIDER_ID,
    modelId: TEST_MODEL_ID,
    content: [{ type: "text", text: "Hello from assistant" }],
    stopReason: "stop",
    ts: Date.now(),
    ...overrides,
  };
}

function makeToolCallAssistantMessage(): AssistantMessage {
  return {
    role: "assistant",
    id: "ast-tc",
    api: "openai-chat-completions",
    providerId: TEST_PROVIDER_ID,
    modelId: TEST_MODEL_ID,
    content: [
      { type: "text", text: "Let me check that." },
      { type: "toolCall", id: "tc-1", name: "bash", arguments: { command: "ls" } },
    ],
    stopReason: "toolUse",
    ts: Date.now(),
  };
}

/**
 * Creates a mock adapter that returns pre-configured responses.
 * Simulates streaming events for each response.
 */
function createMockAdapter(responses: AssistantMessage[]): ProviderAdapter & { callCount: number } {
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

      // Check abort before starting
      if (opts.signal?.aborted) {
        const aborted: AssistantMessage = { ...msg, content: [], stopReason: "aborted" };
        onEvent({ type: "error", reason: "aborted", error: aborted });
        return aborted;
      }

      onEvent({ type: "start", partial: msg });

      for (const part of msg.content) {
        if (part.type === "text") {
          onEvent({ type: "text_delta", contentIndex: 0, delta: part.text, partial: msg });
          onEvent({ type: "text_end", contentIndex: 0, content: part.text, partial: msg });
        }
      }

      onEvent({ type: "done", reason: msg.stopReason, message: msg });
      return msg;
    },
  };
  return adapter;
}

/**
 * Creates a mock adapter that blocks until the abort signal fires,
 * then returns an aborted message with optional visible output.
 */
function createBlockingAdapter(opts?: { visibleOutput?: boolean }): ProviderAdapter {
  return {
    api: "openai-chat-completions",
    async stream(
      _config: ProviderConfig,
      _apiKey: string,
      reqOpts: ProviderRequestOptions,
      onEvent: (event: AssistantMessageEvent) => void,
    ): Promise<AssistantMessage> {
      const content: ContentPart[] = opts?.visibleOutput
        ? [{ type: "text", text: "partial output" }]
        : [];

      const abortedMsg: AssistantMessage = {
        role: "assistant",
        id: "ast-blocked",
        api: "openai-chat-completions",
        providerId: TEST_PROVIDER_ID,
        modelId: TEST_MODEL_ID,
        content,
        stopReason: "aborted",
        ts: Date.now(),
      };

      onEvent({ type: "start", partial: abortedMsg });

      if (opts?.visibleOutput) {
        onEvent({ type: "text_delta", contentIndex: 0, delta: "partial output", partial: abortedMsg });
      }

      // Wait for abort
      await new Promise<void>((resolve) => {
        if (reqOpts.signal?.aborted) {
          resolve();
          return;
        }
        reqOpts.signal?.addEventListener("abort", () => resolve(), { once: true });
      });

      onEvent({ type: "error", reason: "aborted", error: abortedMsg });
      return abortedMsg;
    },
  };
}

function createProviderEntry(adapter: ProviderAdapter, apiKey: string | null = "sk-test"): ProviderEntry {
  return {
    config: TEST_PROVIDER_CONFIG,
    adapter,
    getApiKey: async () => apiKey,
  };
}

function collectAppEvents(eventBus: EventBus): ScorelEvent[] {
  const events: ScorelEvent[] = [];
  eventBus.onAppEvent((e) => events.push(e));
  return events;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Orchestrator", () => {
  let db: Database.Database;
  let sessionManager: SessionManager;
  let eventBus: EventBus;

  beforeEach(() => {
    db = initDatabase(":memory:");
    sessionManager = new SessionManager(db);
    eventBus = new EventBus();
  });

  function createOrchestrator(
    adapter: ProviderAdapter,
    apiKey: string | null = "sk-test",
    toolRunner?: ToolRunner,
  ): Orchestrator {
    const providers = new Map<string, ProviderEntry>();
    providers.set(TEST_PROVIDER_ID, createProviderEntry(adapter, apiKey));
    return new Orchestrator({ db, sessionManager, eventBus, providers, toolRunner });
  }

  function createSession(): string {
    return sessionManager.create("/tmp/workspace", {
      providerId: TEST_PROVIDER_ID,
      modelId: TEST_MODEL_ID,
    });
  }

  // 1. send() text-only: user + assistant persisted, events emitted, state idle
  it("send() persists user and assistant messages and emits events", async () => {
    const response = makeAssistantMessage();
    const adapter = createMockAdapter([response]);
    const orch = createOrchestrator(adapter);
    const sessionId = createSession();
    const events = collectAppEvents(eventBus);

    await orch.send(sessionId, "Hello");

    // Messages persisted
    const msgs = sessionManager.getMessages(sessionId);
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe("user");
    expect((msgs[0] as { content: string }).content).toBe("Hello");
    expect(msgs[1].role).toBe("assistant");
    expect(msgs[1].id).toBe(response.id);

    // State returns to idle
    expect(sessionManager.getState(sessionId)).toBe("idle");

    // AbortController cleared
    expect(sessionManager.getAbortController(sessionId)).toBeNull();

    // Events: user.prompt, llm.request, llm.stream (multiple), llm.done
    const types = events.map((e) => e.type);
    expect(types).toContain("user.prompt");
    expect(types).toContain("llm.request");
    expect(types).toContain("llm.stream");
    expect(types).toContain("llm.done");

    // Adapter was called once
    expect(adapter.callCount).toBe(1);
  });

  it("send() uses lightweight session metadata during the model loop", async () => {
    const response = makeAssistantMessage();
    const adapter = createMockAdapter([response]);
    const orch = createOrchestrator(adapter);
    const sessionId = createSession();
    const getSpy = vi.spyOn(sessionManager, "get");
    const getMetaSpy = vi.spyOn(sessionManager, "getMeta");

    await orch.send(sessionId, "Hello");

    expect(getMetaSpy).toHaveBeenCalled();
    expect(getSpy).not.toHaveBeenCalled();
  });

  // 2. send() with tool calls
  it("send() persists assistant message with tool calls", async () => {
    const response = makeToolCallAssistantMessage();
    const adapter = createMockAdapter([response]);
    const orch = createOrchestrator(adapter);
    const sessionId = createSession();

    await orch.send(sessionId, "Run ls");

    const msgs = sessionManager.getMessages(sessionId);
    expect(msgs).toHaveLength(2);

    const assistant = msgs[1] as AssistantMessage;
    expect(assistant.stopReason).toBe("toolUse");
    expect(assistant.content).toHaveLength(2);
    expect(assistant.content[0].type).toBe("text");
    expect(assistant.content[1].type).toBe("toolCall");
  });

  // 3. send() twice: both rounds work, seq ordering correct
  it("send() twice produces correct seq ordering", async () => {
    const r1 = makeAssistantMessage({ id: "ast-r1" });
    const r2 = makeAssistantMessage({ id: "ast-r2", content: [{ type: "text", text: "Second reply" }] });
    const adapter = createMockAdapter([r1, r2]);
    const orch = createOrchestrator(adapter);
    const sessionId = createSession();

    await orch.send(sessionId, "First");
    await orch.send(sessionId, "Second");

    const msgs = sessionManager.getMessages(sessionId);
    expect(msgs).toHaveLength(4);
    expect(msgs[0].role).toBe("user");
    expect(msgs[1].role).toBe("assistant");
    expect(msgs[1].id).toBe("ast-r1");
    expect(msgs[2].role).toBe("user");
    expect(msgs[3].role).toBe("assistant");
    expect(msgs[3].id).toBe("ast-r2");

    // State is idle after both
    expect(sessionManager.getState(sessionId)).toBe("idle");
    expect(adapter.callCount).toBe(2);
  });

  // 4. abort() during streaming with visible output — persisted
  it("abort() during streaming persists aborted message with visible output", async () => {
    const adapter = createBlockingAdapter({ visibleOutput: true });
    const orch = createOrchestrator(adapter);
    const sessionId = createSession();
    const events = collectAppEvents(eventBus);

    // Start send in background, then abort
    const sendPromise = orch.send(sessionId, "Hello");

    // Wait a tick for streaming to start
    await new Promise((r) => setTimeout(r, 10));

    orch.abort(sessionId);
    await sendPromise;

    const msgs = sessionManager.getMessages(sessionId);
    // user + aborted assistant (has visible output)
    expect(msgs).toHaveLength(2);
    expect(msgs[1].role).toBe("assistant");
    expect((msgs[1] as AssistantMessage).stopReason).toBe("aborted");

    // session.abort event emitted
    expect(events.some((e) => e.type === "session.abort")).toBe(true);

    // State returns to idle
    expect(sessionManager.getState(sessionId)).toBe("idle");
  });

  // 5. abort() before any delta — no assistant persisted
  it("abort() before any visible output does not persist assistant", async () => {
    const adapter = createBlockingAdapter({ visibleOutput: false });
    const orch = createOrchestrator(adapter);
    const sessionId = createSession();

    const sendPromise = orch.send(sessionId, "Hello");
    await new Promise((r) => setTimeout(r, 10));

    orch.abort(sessionId);
    await sendPromise;

    const msgs = sessionManager.getMessages(sessionId);
    // Only user message persisted
    expect(msgs).toHaveLength(1);
    expect(msgs[0].role).toBe("user");

    expect(sessionManager.getState(sessionId)).toBe("idle");
  });

  // 6. send() when not idle
  it("send() throws when session is not idle", async () => {
    const adapter = createMockAdapter([makeAssistantMessage()]);
    const orch = createOrchestrator(adapter);
    const sessionId = createSession();

    sessionManager.setState(sessionId, "streaming");

    await expect(orch.send(sessionId, "Hello")).rejects.toThrow(
      /is in state "streaming", expected "idle"/,
    );
  });

  // 7. send() with missing provider
  it("send() throws when provider is not found", async () => {
    const orch = new Orchestrator({
      db,
      sessionManager,
      eventBus,
      providers: new Map(), // empty
    });
    const sessionId = createSession();

    await expect(orch.send(sessionId, "Hello")).rejects.toThrow(
      /Provider "test-provider" not found/,
    );
  });

  // 8. send() with missing API key
  it("send() throws when API key is missing", async () => {
    const adapter = createMockAdapter([makeAssistantMessage()]);
    const orch = createOrchestrator(adapter, null);
    const sessionId = createSession();

    await expect(orch.send(sessionId, "Hello")).rejects.toThrow(
      /No API key for provider/,
    );
  });

  // 9. send() with non-existent session
  it("send() throws for non-existent session", async () => {
    const adapter = createMockAdapter([makeAssistantMessage()]);
    const orch = createOrchestrator(adapter);

    await expect(orch.send("nonexistent", "Hello")).rejects.toThrow(
      /not found/,
    );
  });

  // 10. abort() on idle session is a no-op
  it("abort() on idle session is a no-op", () => {
    const adapter = createMockAdapter([]);
    const orch = createOrchestrator(adapter);
    const sessionId = createSession();
    const events = collectAppEvents(eventBus);

    // Should not throw
    orch.abort(sessionId);

    // No session.abort event since there was no controller
    expect(events.some((e) => e.type === "session.abort")).toBe(false);
  });

  it("abortAll() aborts every active session controller", () => {
    const adapter = createMockAdapter([]);
    const orch = createOrchestrator(adapter);
    const firstSessionId = createSession();
    const secondSessionId = createSession();
    const idleSessionId = createSession();
    const firstController = new AbortController();
    const secondController = new AbortController();
    const idleController = new AbortController();
    const events = collectAppEvents(eventBus);

    sessionManager.setState(firstSessionId, "streaming");
    sessionManager.setState(secondSessionId, "tooling");
    sessionManager.setAbortController(firstSessionId, firstController);
    sessionManager.setAbortController(secondSessionId, secondController);
    sessionManager.setAbortController(idleSessionId, idleController);

    orch.abortAll();

    expect(firstController.signal.aborted).toBe(true);
    expect(secondController.signal.aborted).toBe(true);
    expect(idleController.signal.aborted).toBe(false);
    expect(sessionManager.getState(firstSessionId)).toBe("idle");
    expect(sessionManager.getState(secondSessionId)).toBe("idle");
    expect(sessionManager.getState(idleSessionId)).toBe("idle");
    expect(events.filter((event) => event.type === "session.abort")).toHaveLength(2);
  });

  it("shutdownRunner() stops the active tool runner", async () => {
    const adapter = createMockAdapter([]);
    const toolRunner: ToolRunner = {
      execute: vi.fn(),
      abort: vi.fn(),
      start: vi.fn(),
      stop: vi.fn().mockResolvedValue(undefined),
    };
    const orch = createOrchestrator(adapter, "sk-test", toolRunner);

    await orch.shutdownRunner(3000);

    expect(toolRunner.stop).toHaveBeenCalledTimes(1);
  });

  it("shutdownRunner() resolves when runner shutdown times out", async () => {
    vi.useFakeTimers();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const adapter = createMockAdapter([]);
    const toolRunner: ToolRunner = {
      execute: vi.fn(),
      abort: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(() => new Promise<void>(() => {})),
    };
    const orch = createOrchestrator(adapter, "sk-test", toolRunner);

    const shutdownPromise = orch.shutdownRunner(3000);
    await vi.advanceTimersByTimeAsync(3000);
    await shutdownPromise;

    expect(toolRunner.stop).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith("Runner shutdown timed out after 3000ms");

    warnSpy.mockRestore();
    vi.useRealTimers();
  });

  // 11. stream events forwarded to EventBus
  it("forwards stream events to EventBus", async () => {
    const response = makeAssistantMessage();
    const adapter = createMockAdapter([response]);
    const orch = createOrchestrator(adapter);
    const sessionId = createSession();

    const streamEvents: AssistantMessageEvent[] = [];
    eventBus.onStreamEvent(sessionId, (e) => streamEvents.push(e));

    await orch.send(sessionId, "Hello");

    // Should have start, text_delta, text_end, done
    const types = streamEvents.map((e) => e.type);
    expect(types).toContain("start");
    expect(types).toContain("done");
  });

  // 12. state restored to idle even on adapter error
  it("restores state to idle on adapter error", async () => {
    const errorAdapter: ProviderAdapter = {
      api: "openai-chat-completions",
      async stream() {
        throw new Error("Network failure");
      },
    };
    const orch = createOrchestrator(errorAdapter);
    const sessionId = createSession();

    await expect(orch.send(sessionId, "Hello")).rejects.toThrow("Network failure");

    expect(sessionManager.getState(sessionId)).toBe("idle");
    expect(sessionManager.getAbortController(sessionId)).toBeNull();
  });
});
