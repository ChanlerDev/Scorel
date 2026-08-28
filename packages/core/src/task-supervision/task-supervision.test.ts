import { beforeEach, describe, expect, it } from "vitest";

import { asClientId, asEventId, asSeq, asSessionId } from "@scorel/protocol";
import type { PersistentEvent } from "@scorel/protocol";

import {
  buildSupervisionReminder,
  checkSupervision,
  createInitialSupervisionState,
  deriveTaskSupervisionFromEvents,
  resetSupervisionForNewTurn,
  updateSupervisionState,
} from "./index.js";
import type { TaskBudgetConfig } from "../config/index.js";

// --- helpers ---

let idCounter = 0;
const nextId = () => asEventId(`evt-${++idCounter}`);
const sessionId = asSessionId("sess-test");
const clientId = asClientId("client-test");

const baseFields = () => ({
  id: nextId(),
  parentId: null,
  seq: asSeq(idCounter),
  sessionId,
  clientId,
});

const userMessageEvent = (ts: number): PersistentEvent => ({
  ...baseFields(),
  type: "user_message",
  ts,
  message: {
    role: "user",
    content: [{ type: "text", text: "Do something" }],
  },
});

const assistantMessageEvent = (
  ts: number,
  opts: {
    text?: string;
    toolCalls?: Array<{ toolName: string; toolCallId: string; args: unknown }>;
    usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
  },
): PersistentEvent => ({
  ...baseFields(),
  type: "assistant_message",
  ts,
  message: {
    role: "assistant",
    content: [
      ...(opts.text ? [{ type: "text" as const, text: opts.text }] : []),
      ...(opts.toolCalls ?? []).map((tc) => ({
        type: "tool_call" as const,
        toolName: tc.toolName,
        toolCallId: tc.toolCallId,
        args: tc.args,
      })),
    ],
    stopReason: opts.toolCalls ? "tool_call" : "end_turn",
    ...(opts.usage ? { usage: opts.usage } : {}),
  },
});

const toolResultEvent = (
  ts: number,
  opts: { toolCallId: string; toolName: string; isError: boolean },
): PersistentEvent => ({
  ...baseFields(),
  type: "tool_result",
  ts,
  message: {
    role: "tool_result",
    content: [{
      type: "tool_result",
      toolCallId: opts.toolCallId,
      toolName: opts.toolName,
      result: { content: [{ type: "text", text: "ok" }] },
      isError: opts.isError,
    }],
  },
});

const defaultBudget: TaskBudgetConfig = {
  maxTokens: 0,
  maxCostUsd: 0,
  maxWallClockMinutes: 0,
  repeatedCommandThreshold: 3,
  staleProgressMinutes: 10,
};

// Reset counter between tests
beforeEach(() => { idCounter = 0; });

// --- tests ---

describe("task-supervision", () => {
  describe("createInitialSupervisionState", () => {
    it("returns state with zero usage and undefined timestamps", () => {
      const state = createInitialSupervisionState();
      expect(state.startedAt).toBeUndefined();
      expect(state.lastProgressAt).toBeUndefined();
      expect(state.usage.totalTokens).toBe(0);
      expect(state.cost.total).toBe(0);
      expect(state.consecutiveErrors).toBe(0);
      expect(state.consecutiveRepeatedCommands).toBe(0);
      expect(state.recentToolCalls).toHaveLength(0);
    });
  });

  describe("deriveTaskSupervisionFromEvents", () => {
    it("sets startedAt from first user message", () => {
      const state = deriveTaskSupervisionFromEvents([userMessageEvent(1000)]);
      expect(state.startedAt).toBe(1000);
    });

    it("accumulates token usage from assistant messages", () => {
      const events = [
        userMessageEvent(1000),
        assistantMessageEvent(2000, {
          text: "hello",
          usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
        }),
      ];
      const state = deriveTaskSupervisionFromEvents(events);
      expect(state.usage.inputTokens).toBe(100);
      expect(state.usage.outputTokens).toBe(50);
      expect(state.usage.totalTokens).toBe(150);
    });

    it("tracks consecutive errors and resets on success", () => {
      const events = [
        userMessageEvent(1000),
        assistantMessageEvent(2000, {
          toolCalls: [{ toolName: "Bash", toolCallId: "tc1", args: { command: "ls" } }],
        }),
        toolResultEvent(3000, { toolName: "Bash", toolCallId: "tc1", isError: true }),
        assistantMessageEvent(4000, {
          toolCalls: [{ toolName: "Bash", toolCallId: "tc2", args: { command: "ls" } }],
        }),
        toolResultEvent(5000, { toolName: "Bash", toolCallId: "tc2", isError: true }),
        assistantMessageEvent(6000, {
          toolCalls: [{ toolName: "Bash", toolCallId: "tc3", args: { command: "ls" } }],
        }),
        toolResultEvent(7000, { toolName: "Bash", toolCallId: "tc3", isError: false }),
      ];
      const state = deriveTaskSupervisionFromEvents(events);
      expect(state.consecutiveErrors).toBe(0);
    });

    it("counts consecutive repeated Bash commands", () => {
      const events = [
        userMessageEvent(1000),
        assistantMessageEvent(2000, {
          toolCalls: [{ toolName: "Bash", toolCallId: "tc1", args: { command: "npm test" } }],
        }),
        toolResultEvent(3000, { toolName: "Bash", toolCallId: "tc1", isError: true }),
        assistantMessageEvent(4000, {
          toolCalls: [{ toolName: "Bash", toolCallId: "tc2", args: { command: "npm test" } }],
        }),
        toolResultEvent(5000, { toolName: "Bash", toolCallId: "tc2", isError: true }),
        assistantMessageEvent(6000, {
          toolCalls: [{ toolName: "Bash", toolCallId: "tc3", args: { command: "npm test" } }],
        }),
      ];
      const state = deriveTaskSupervisionFromEvents(events);
      expect(state.consecutiveRepeatedCommands).toBe(3);
      expect(state.lastBashCommand).toBe("npm test");
    });

    it("resets repeated command count on different command", () => {
      const events = [
        userMessageEvent(1000),
        assistantMessageEvent(2000, {
          toolCalls: [{ toolName: "Bash", toolCallId: "tc1", args: { command: "npm test" } }],
        }),
        assistantMessageEvent(3000, {
          toolCalls: [{ toolName: "Bash", toolCallId: "tc2", args: { command: "npm run build" } }],
        }),
      ];
      const state = deriveTaskSupervisionFromEvents(events);
      expect(state.consecutiveRepeatedCommands).toBe(1);
      expect(state.lastBashCommand).toBe("npm run build");
    });

    it("is replay-safe: same events produce same state", () => {
      const events = [
        userMessageEvent(1000),
        assistantMessageEvent(2000, {
          text: "hello",
          usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
        }),
      ];
      const state1 = deriveTaskSupervisionFromEvents(events);
      const state2 = deriveTaskSupervisionFromEvents(events);
      expect(state1.usage).toEqual(state2.usage);
      expect(state1.startedAt).toBe(state2.startedAt);
      expect(state1.lastProgressAt).toBe(state2.lastProgressAt);
    });
  });

  describe("updateSupervisionState", () => {
    it("updates lastProgressAt on assistant text", () => {
      const state = createInitialSupervisionState();
      updateSupervisionState(state, userMessageEvent(1000));
      updateSupervisionState(state, assistantMessageEvent(2000, { text: "hello" }));
      expect(state.lastProgressAt).toBe(2000);
    });

    it("updates lastProgressAt on successful tool result", () => {
      const state = createInitialSupervisionState();
      updateSupervisionState(state, userMessageEvent(1000));
      updateSupervisionState(state, assistantMessageEvent(2000, {
        toolCalls: [{ toolName: "Bash", toolCallId: "tc1", args: { command: "ls" } }],
      }));
      updateSupervisionState(state, toolResultEvent(3000, {
        toolName: "Bash", toolCallId: "tc1", isError: false,
      }));
      expect(state.lastProgressAt).toBe(3000);
    });

    it("does not update lastProgressAt on error tool result", () => {
      const state = createInitialSupervisionState();
      updateSupervisionState(state, userMessageEvent(1000));
      updateSupervisionState(state, assistantMessageEvent(2000, {
        toolCalls: [{ toolName: "Bash", toolCallId: "tc1", args: { command: "ls" } }],
      }));
      updateSupervisionState(state, toolResultEvent(3000, {
        toolName: "Bash", toolCallId: "tc1", isError: true,
      }));
      expect(state.lastProgressAt).toBe(2000);
    });

    it("increments consecutiveErrors on error and resets on success", () => {
      const state = createInitialSupervisionState();
      updateSupervisionState(state, userMessageEvent(1000));
      updateSupervisionState(state, assistantMessageEvent(2000, {
        toolCalls: [{ toolName: "Bash", toolCallId: "tc1", args: { command: "ls" } }],
      }));
      updateSupervisionState(state, toolResultEvent(3000, {
        toolName: "Bash", toolCallId: "tc1", isError: true,
      }));
      expect(state.consecutiveErrors).toBe(1);
      updateSupervisionState(state, assistantMessageEvent(4000, {
        toolCalls: [{ toolName: "Bash", toolCallId: "tc2", args: { command: "ls" } }],
      }));
      updateSupervisionState(state, toolResultEvent(5000, {
        toolName: "Bash", toolCallId: "tc2", isError: false,
      }));
      expect(state.consecutiveErrors).toBe(0);
    });
  });

  describe("checkSupervision", () => {
    it("returns no violations when all budgets are 0 (disabled)", () => {
      const state = createInitialSupervisionState();
      state.usage.inputTokens = 100_000;
      state.usage.outputTokens = 50_000;
      state.usage.totalTokens = 150_000;
      const result = checkSupervision(state, defaultBudget, 2000);
      expect(result.violations).toHaveLength(0);
    });

    it("detects token budget violation", () => {
      const state = createInitialSupervisionState();
      state.usage.inputTokens = 100_000;
      state.usage.outputTokens = 50_000;
      state.usage.totalTokens = 150_000;
      const result = checkSupervision(state, { ...defaultBudget, maxTokens: 120_000 }, 2000);
      expect(result.violations).toContainEqual(
        expect.objectContaining({ type: "token_budget", current: 150_000, limit: 120_000 }),
      );
    });

    it("does not flag token violation when under limit", () => {
      const state = createInitialSupervisionState();
      state.usage.inputTokens = 1000;
      state.usage.outputTokens = 500;
      state.usage.totalTokens = 1500;
      const result = checkSupervision(state, { ...defaultBudget, maxTokens: 200_000 }, 2000);
      expect(result.violations.find((v) => v.type === "token_budget")).toBeUndefined();
    });

    it("detects cost budget violation", () => {
      const state = createInitialSupervisionState();
      state.cost = { ...state.cost, known: true, total: 5.0 };
      const result = checkSupervision(state, { ...defaultBudget, maxCostUsd: 1.0 }, 2000);
      expect(result.violations).toContainEqual(
        expect.objectContaining({ type: "cost_budget", current: 5.0, limit: 1.0 }),
      );
    });

    it("detects wall-clock budget violation", () => {
      const state = createInitialSupervisionState();
      state.startedAt = 1000;
      const now = 1000 + 20 * 60 * 1000; // 20 minutes later
      const result = checkSupervision(state, { ...defaultBudget, maxWallClockMinutes: 10 }, now);
      expect(result.violations).toContainEqual(
        expect.objectContaining({ type: "wall_clock_budget" }),
      );
    });

    it("detects repeated command violation", () => {
      const state = createInitialSupervisionState();
      state.consecutiveRepeatedCommands = 3;
      state.lastBashCommand = "npm test";
      const result = checkSupervision(state, { ...defaultBudget, repeatedCommandThreshold: 3 }, 2000);
      const violation = result.violations.find((v) => v.type === "repeated_command");
      expect(violation).toBeDefined();
      expect(violation).toMatchObject({ command: "npm test", count: 3 });
    });

    it("detects consecutive errors violation", () => {
      const state = createInitialSupervisionState();
      state.consecutiveErrors = 3;
      const result = checkSupervision(state, { ...defaultBudget, repeatedCommandThreshold: 3 }, 2000);
      expect(result.violations).toContainEqual(
        expect.objectContaining({ type: "consecutive_errors", count: 3 }),
      );
    });

    it("detects stale progress violation", () => {
      const state = createInitialSupervisionState();
      state.lastProgressAt = 1000;
      const now = 1000 + 20 * 60 * 1000; // 20 minutes later
      const result = checkSupervision(state, { ...defaultBudget, staleProgressMinutes: 10 }, now);
      expect(result.violations).toContainEqual(
        expect.objectContaining({ type: "stale_progress" }),
      );
    });

    it("returns no violations when within all budgets", () => {
      const state = createInitialSupervisionState();
      state.usage.inputTokens = 1000;
      state.usage.outputTokens = 500;
      state.usage.totalTokens = 1500;
      state.startedAt = 1000;
      state.lastProgressAt = 1500;
      const result = checkSupervision(state, {
        maxTokens: 100_000,
        maxCostUsd: 10,
        maxWallClockMinutes: 60,
        repeatedCommandThreshold: 5,
        staleProgressMinutes: 30,
      }, 2000);
      expect(result.violations).toHaveLength(0);
    });
  });

  describe("buildSupervisionReminder", () => {
    it("includes violation details in the reminder text", () => {
      const state = createInitialSupervisionState();
      state.usage.inputTokens = 100_000;
      state.usage.outputTokens = 50_000;
      state.usage.totalTokens = 150_000;
      state.startedAt = Date.now() - 60_000;

      const reminder = buildSupervisionReminder(
        [{ type: "token_budget", current: 150_000, limit: 120_000 }],
        state,
      );

      expect(reminder).toContain("Task supervision alert");
      expect(reminder).toContain("Token budget exceeded");
      expect(reminder).toContain("150,000");
      expect(reminder).toContain("120,000");
      expect(reminder).toContain("Summarize what you have done");
      expect(reminder).toContain("Re-evaluate your strategy");
    });

    it("includes repeated command info", () => {
      const state = createInitialSupervisionState();
      state.lastBashCommand = "npm test";
      const reminder = buildSupervisionReminder(
        [{ type: "repeated_command", count: 3, threshold: 3, command: "npm test" }],
        state,
      );
      expect(reminder).toContain("npm test");
      expect(reminder).toContain("3x");
    });
  });

  describe("resetSupervisionForNewTurn", () => {
    it("resets error and repeat counters", () => {
      const state = createInitialSupervisionState();
      state.consecutiveErrors = 5;
      state.consecutiveRepeatedCommands = 3;
      state.lastBashCommand = "npm test";
      state.recentToolCalls = [{ toolName: "Bash", argsHash: "test" }];
      resetSupervisionForNewTurn(state);
      expect(state.consecutiveErrors).toBe(0);
      expect(state.consecutiveRepeatedCommands).toBe(0);
      expect(state.lastBashCommand).toBeUndefined();
      expect(state.recentToolCalls).toHaveLength(0);
    });
  });
});
