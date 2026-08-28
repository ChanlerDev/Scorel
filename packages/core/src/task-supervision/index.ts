import type { PersistentEvent, Usage } from "@scorel/protocol";

import { estimateRunCost, type RunCostEstimate, type RunReportingModel } from "../reporting/index.js";
import type { TaskBudgetConfig } from "../config/index.js";

export type TaskSupervisionState = {
  /** Wall-clock start time of the first user message in this session (ms epoch). */
  startedAt: number | undefined;
  /** Timestamp of the last progress signal (ms epoch). */
  lastProgressAt: number | undefined;
  /** Cumulative token usage derived from assistant_message events. */
  usage: Required<Usage>;
  /** Cumulative cost estimate derived from assistant_message events. */
  cost: RunCostEstimate;
  /** Sequence of recent tool calls for repeat detection: toolName + argsHash. */
  recentToolCalls: ToolCallSignature[];
  /** Count of consecutive tool results that returned errors (reset on success). */
  consecutiveErrors: number;
  /** Count of consecutive identical Bash commands (reset on different command). */
  consecutiveRepeatedCommands: number;
  /** The last Bash command string, for repeat detection. */
  lastBashCommand: string | undefined;
};

type ToolCallSignature = {
  toolName: string;
  argsHash: string;
};

export type SupervisionViolation =
  | { type: "token_budget"; current: number; limit: number }
  | { type: "cost_budget"; current: number; limit: number }
  | { type: "wall_clock_budget"; currentMinutes: number; limitMinutes: number }
  | { type: "repeated_command"; count: number; threshold: number; command: string }
  | { type: "consecutive_errors"; count: number; threshold: number }
  | { type: "stale_progress"; staleMinutes: number; limitMinutes: number };

export type SupervisionCheckResult = {
  violations: SupervisionViolation[];
};

export const DEFAULT_TASK_BUDGET_CONFIG: TaskBudgetConfig = {
  maxTokens: 0,
  maxCostUsd: 0,
  maxWallClockMinutes: 0,
  repeatedCommandThreshold: 3,
  staleProgressMinutes: 10,
};

export const createInitialSupervisionState = (): TaskSupervisionState => ({
  startedAt: undefined,
  lastProgressAt: undefined,
  usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0 },
  cost: {
    known: false,
    currency: "USD",
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    total: 0,
    pricingSource: "official-provider-pricing-2026-08-07",
  },
  recentToolCalls: [],
  consecutiveErrors: 0,
  consecutiveRepeatedCommands: 0,
  lastBashCommand: undefined,
});

/**
 * Derive supervision state from a sequence of persistent events.
 * This is replay-safe: the same event sequence always produces the same state.
 */
export const deriveTaskSupervisionFromEvents = (
  events: PersistentEvent[],
  model?: RunReportingModel,
): TaskSupervisionState => {
  const state = createInitialSupervisionState();

  for (const event of events) {
    updateSupervisionState(state, event, model);
  }

  return state;
};

/**
 * Incrementally update supervision state with a single persistent event.
 * This is the primary hook used by the daemon after each event is persisted.
 */
export const updateSupervisionState = (
  state: TaskSupervisionState,
  event: PersistentEvent,
  model?: RunReportingModel,
): void => {
  const ts = event.ts;

  switch (event.type) {
    case "user_message": {
      if (state.startedAt === undefined) {
        state.startedAt = ts;
      }
      state.lastProgressAt = ts;
      // User messages reset progress tracking but not error/repeat counters
      break;
    }
    case "assistant_message": {
      const usage = event.message.usage;
      if (usage) {
        state.usage.inputTokens += nonNeg(usage.inputTokens);
        state.usage.outputTokens += nonNeg(usage.outputTokens);
        state.usage.cacheReadTokens += nonNeg(usage.cacheReadTokens);
        state.usage.cacheWriteTokens += nonNeg(usage.cacheWriteTokens);
        state.usage.totalTokens += nonNeg(usage.totalTokens);
      }
      // Recalculate cost from aggregate usage
      state.cost = estimateRunCost(state.usage, model);

      // Any assistant text output or tool call is progress
      const hasProgress = event.message.content.some(
        (block) =>
          (block.type === "text" && block.text.trim().length > 0)
          || block.type === "tool_call",
      );
      if (hasProgress) {
        state.lastProgressAt = ts;
      }

      // Track tool calls from assistant messages for repeat detection
      for (const block of event.message.content) {
        if (block.type === "tool_call") {
          const sig: ToolCallSignature = {
            toolName: block.toolName,
            argsHash: hashArgs(block.args),
          };
          state.recentToolCalls.push(sig);

          // Bash repeat detection
          if (block.toolName === "Bash") {
            const cmd = bashCommandFromArgs(block.args);
            if (cmd !== undefined) {
              if (state.lastBashCommand !== undefined && cmd === state.lastBashCommand) {
                state.consecutiveRepeatedCommands += 1;
              } else {
                state.consecutiveRepeatedCommands = 1;
                state.lastBashCommand = cmd;
              }
            }
          }
        }
      }
      break;
    }
    case "tool_result": {
      const isError = event.message.content.some(
        (block) => block.type === "tool_result" && block.isError,
      );
      if (isError) {
        state.consecutiveErrors += 1;
      } else {
        state.consecutiveErrors = 0;
        state.lastProgressAt = ts;
      }
      break;
    }
    case "compact": {
      // Compact events indicate context management activity, count as progress
      state.lastProgressAt = ts;
      break;
    }
    default:
      // Other event types don't affect supervision state
      break;
  }
};

/**
 * Check budget thresholds and progress stagnation against the configured budget.
 * Returns a list of violations that should trigger a supervision reminder.
 */
export const checkSupervision = (
  state: TaskSupervisionState,
  config: TaskBudgetConfig,
  now: number,
): SupervisionCheckResult => {
  const violations: SupervisionViolation[] = [];

  // Token budget
  if (config.maxTokens > 0 && state.usage.totalTokens > 0) {
    const current = state.usage.inputTokens + state.usage.outputTokens
      + state.usage.cacheReadTokens + state.usage.cacheWriteTokens;
    if (current > config.maxTokens) {
      violations.push({ type: "token_budget", current, limit: config.maxTokens });
    }
  }

  // Cost budget
  if (config.maxCostUsd > 0 && state.cost.total > 0) {
    if (state.cost.total > config.maxCostUsd) {
      violations.push({ type: "cost_budget", current: state.cost.total, limit: config.maxCostUsd });
    }
  }

  // Wall-clock budget
  if (config.maxWallClockMinutes > 0 && state.startedAt !== undefined) {
    const elapsedMinutes = (now - state.startedAt) / 60_000;
    if (elapsedMinutes > config.maxWallClockMinutes) {
      violations.push({
        type: "wall_clock_budget",
        currentMinutes: elapsedMinutes,
        limitMinutes: config.maxWallClockMinutes,
      });
    }
  }

  // Repeated command detection
  if (config.repeatedCommandThreshold > 0 && state.consecutiveRepeatedCommands >= config.repeatedCommandThreshold) {
    violations.push({
      type: "repeated_command",
      count: state.consecutiveRepeatedCommands,
      threshold: config.repeatedCommandThreshold,
      command: state.lastBashCommand ?? "",
    });
  }

  // Consecutive errors
  if (config.repeatedCommandThreshold > 0 && state.consecutiveErrors >= config.repeatedCommandThreshold) {
    violations.push({
      type: "consecutive_errors",
      count: state.consecutiveErrors,
      threshold: config.repeatedCommandThreshold,
    });
  }

  // Stale progress
  if (config.staleProgressMinutes > 0 && state.lastProgressAt !== undefined) {
    const staleMinutes = (now - state.lastProgressAt) / 60_000;
    if (staleMinutes > config.staleProgressMinutes) {
      violations.push({
        type: "stale_progress",
        staleMinutes,
        limitMinutes: config.staleProgressMinutes,
      });
    }
  }

  return { violations };
};

/**
 * Build the reminder text injected as a harness_item runtime_notice.
 * The text guides the model to summarize state and re-evaluate strategy.
 */
export const buildSupervisionReminder = (
  violations: SupervisionViolation[],
  state: TaskSupervisionState,
): string => {
  const lines: string[] = [
    "Task supervision alert — budget or progress threshold exceeded.",
    "",
    "Current session status:",
  ];

  const totalTokens = state.usage.inputTokens + state.usage.outputTokens
    + state.usage.cacheReadTokens + state.usage.cacheWriteTokens;
  lines.push(`  Tokens used: ${totalTokens.toLocaleString()} (input: ${state.usage.inputTokens.toLocaleString()}, output: ${state.usage.outputTokens.toLocaleString()})`);
  lines.push(`  Estimated cost: $${state.cost.total.toFixed(4)}`);

  if (state.startedAt !== undefined) {
    const elapsedMin = (Date.now() - state.startedAt) / 60_000;
    lines.push(`  Elapsed time: ${elapsedMin.toFixed(1)} minutes`);
  }

  lines.push(`  Consecutive tool errors: ${state.consecutiveErrors}`);
  lines.push(`  Repeated Bash commands: ${state.consecutiveRepeatedCommands}`);
  lines.push("");

  lines.push("Violations detected:");
  for (const violation of violations) {
    switch (violation.type) {
      case "token_budget":
        lines.push(`  - Token budget exceeded: ${violation.current.toLocaleString()} / ${violation.limit.toLocaleString()} tokens`);
        break;
      case "cost_budget":
        lines.push(`  - Cost budget exceeded: $${violation.current.toFixed(4)} / $${violation.limit.toFixed(4)}`);
        break;
      case "wall_clock_budget":
        lines.push(`  - Wall-clock budget exceeded: ${violation.currentMinutes.toFixed(1)} / ${violation.limitMinutes} minutes`);
        break;
      case "repeated_command":
        lines.push(`  - Repeated command (${violation.count}x, threshold ${violation.threshold}): ${violation.command}`);
        break;
      case "consecutive_errors":
        lines.push(`  - Consecutive tool errors: ${violation.count} (threshold ${violation.threshold})`);
        break;
      case "stale_progress":
        lines.push(`  - No progress for ${violation.staleMinutes.toFixed(1)} minutes (threshold ${violation.limitMinutes} minutes)`);
        break;
    }
  }

  lines.push("");
  lines.push("Required actions:");
  lines.push("1. Summarize what you have done so far and the current state of the task.");
  lines.push("2. Identify what is not working and why you might be stuck.");
  lines.push("3. Re-evaluate your strategy: consider a different approach, simplify the goal, or ask the user for guidance.");
  lines.push("4. Do NOT repeat the same failed command or approach. Try something different.");

  return lines.join("\n");
};

/**
 * Reset per-user-message counters (called when a new user message starts a new turn).
 */
export const resetSupervisionForNewTurn = (state: TaskSupervisionState): void => {
  state.consecutiveErrors = 0;
  state.consecutiveRepeatedCommands = 0;
  state.lastBashCommand = undefined;
  state.recentToolCalls = [];
};

// --- Helpers ---

const nonNeg = (value: unknown): number => {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return Math.trunc(value);
};

const hashArgs = (args: unknown): string => {
  try {
    return JSON.stringify(args) ?? "";
  } catch {
    return String(args);
  }
};

const bashCommandFromArgs = (args: unknown): string | undefined => {
  if (typeof args !== "object" || args === null) {
    return undefined;
  }
  const record = args as Record<string, unknown>;
  const command = record.command;
  if (typeof command === "string") {
    return command.trim();
  }
  return undefined;
};
