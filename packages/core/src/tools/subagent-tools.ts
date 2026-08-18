import { Type } from "@earendil-works/pi-ai";

import type { ModelRole, ScorelMessage, SessionId } from "@scorel/protocol";

import type { AgentTool, ToolResult } from "./index.js";
import { DEFAULT_BACKGROUND_WAIT_SECONDS, defineTool } from "./index.js";

export type SubagentStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export type SubagentThreadEvent = {
  seq: number;
  type: string;
  role?: string;
  text?: string;
  toolName?: string;
  isError?: boolean;
};

export type SubagentSnapshot = {
  taskId: string;
  childSessionId: SessionId;
  description: string;
  status: SubagentStatus;
  prompt: string;
  role: ModelRole;
  errorMessage?: string;
  /** Last non-empty assistant text content from the child session. */
  finalResult?: string;
  events: SubagentThreadEvent[];
  lastSeq: number;
};

export type SubagentStartResult =
  | { status: "running"; taskId: string; childSessionId: SessionId; description: string }
  | { status: "completed"; taskId: string; childSessionId: SessionId; description: string; result: string }
  | { status: "failed"; taskId: string; childSessionId?: SessionId; description: string; errorMessage: string }
  | { status: "cancelled"; taskId: string; childSessionId?: SessionId; description: string; result?: string };

export type SubagentPollResult =
  | SubagentStartResult
  | {
      status: "delivered";
      taskId: string;
      childSessionId: SessionId;
      description: string;
      eventId?: string;
    };

export type SubagentCompletion = {
  task_id: string;
  child_session_id: SessionId;
  description: string;
  status: "completed" | "failed" | "cancelled";
  result: string;
};

export type SubagentDeliveryHooks = {
  onComplete?: (completion: SubagentCompletion) => Promise<{ eventId?: string } | void>;
  isDeliveryVisible?: (delivery: { task_id: string; eventId?: string }) => boolean;
};

export type SubagentRunner = {
  start(input: {
    prompt: string;
    description: string;
    role: ModelRole;
    signal: AbortSignal;
    onUpdate?: (snapshot: SubagentSnapshot) => void;
  }): Promise<{
    taskId: string;
    childSessionId: SessionId;
    done: Promise<SubagentSnapshot>;
    stop: () => Promise<void>;
    snapshot: () => SubagentSnapshot;
  }>;
  get(taskId: string): SubagentSnapshot | undefined;
  stop(taskId: string): Promise<SubagentSnapshot>;
  hasActiveWork(): boolean;
  /** Host shutdown: cancel every running subagent and its nested tool work. */
  detach(): Promise<void>;
};

export type CreateSubagentToolsOptions = {
  runner: SubagentRunner;
  /** Defaults to DEFAULT_BACKGROUND_WAIT_SECONDS (shared with Bash). */
  defaultWaitTimeSeconds?: number;
  delivery?: SubagentDeliveryHooks;
};

export const createSubagentTools = (options: CreateSubagentToolsOptions): AgentTool[] => {
  const defaultWaitMs = Math.max(
    0,
    (options.defaultWaitTimeSeconds ?? DEFAULT_BACKGROUND_WAIT_SECONDS) * 1_000,
  );
  const returnedRunning = new Set<string>();
  const delivered = new Map<string, string | undefined>();
  const activeWaiters = new Map<string, number>();

  const trackWaiter = (taskId: string, delta: number): void => {
    const next = (activeWaiters.get(taskId) ?? 0) + delta;
    if (next <= 0) {
      activeWaiters.delete(taskId);
    } else {
      activeWaiters.set(taskId, next);
    }
  };

  const maybeDeliver = (snapshot: SubagentSnapshot): void => {
    if (
      !returnedRunning.has(snapshot.taskId)
      || activeWaiters.has(snapshot.taskId)
      || delivered.has(snapshot.taskId)
      || !options.delivery?.onComplete
    ) {
      return;
    }
    if (snapshot.status !== "completed" && snapshot.status !== "failed" && snapshot.status !== "cancelled") {
      return;
    }
    delivered.set(snapshot.taskId, undefined);
    void options.delivery.onComplete({
      task_id: snapshot.taskId,
      child_session_id: snapshot.childSessionId,
      description: snapshot.description,
      status: snapshot.status,
      result: snapshot.finalResult ?? snapshot.errorMessage ?? "",
    }).then((delivery) => {
      delivered.set(snapshot.taskId, delivery?.eventId);
    }).catch(() => {
      delivered.delete(snapshot.taskId);
    });
  };

  const projectResult = (result: SubagentPollResult): ToolResult => {
    if (result.status === "delivered") {
      return textResult(
        [
          `Subagent task ${result.taskId} has already been injected through a system reminder.`,
          "Do not read it again unless the user explicitly asks for the raw result.",
        ].join("\n"),
        {
          status: "delivered",
          task_id: result.taskId,
          child_session_id: result.childSessionId,
          description: result.description,
          ...(result.eventId ? { event_id: result.eventId } : {}),
        },
      );
    }
    if (result.status === "completed") {
      // Parent context only receives the last assistant message content — never the child transcript.
      return textResult(result.result, {
        status: "completed",
        task_id: result.taskId,
        child_session_id: result.childSessionId,
        description: result.description,
      });
    }
    if (result.status === "failed") {
      return textResult(result.errorMessage, {
        status: "failed",
        task_id: result.taskId,
        ...(result.childSessionId ? { child_session_id: result.childSessionId } : {}),
        description: result.description,
      });
    }
    if (result.status === "cancelled") {
      return textResult(result.result ?? `Subagent cancelled: ${result.taskId}`, {
        status: "cancelled",
        task_id: result.taskId,
        ...(result.childSessionId ? { child_session_id: result.childSessionId } : {}),
        description: result.description,
      });
    }
    return textResult(
      [
        "status: running",
        `task_id: ${result.taskId}`,
        `child_session_id: ${result.childSessionId}`,
        `description: ${result.description}`,
      ].join("\n"),
      {
        status: "running",
        task_id: result.taskId,
        child_session_id: result.childSessionId,
        description: result.description,
      },
    );
  };

  return [
    defineTool({
      name: "Task",
      description: [
        "Run a nested subagent with an isolated context window for a focused multi-step subtask.",
        "The subagent starts from a fresh user message (your prompt) and does not inherit the parent conversation.",
        "It gets coding tools in the same project workspace.",
        "If the subagent does not finish within wait_time seconds, it continues in the background and returns a task_id.",
        "Call Task again with task_id to wait (same wait_time semantics) for the final result.",
        "Completed results always return only the subagent's last assistant message content — never the full child transcript.",
        "Do not use nested Task tools inside a subagent (depth is limited to 1).",
      ].join(" "),
      parameters: Type.Object({
        prompt: Type.Optional(Type.String()),
        description: Type.Optional(Type.String()),
        wait_time: Type.Optional(Type.Number()),
        task_id: Type.Optional(Type.String()),
        role: Type.Optional(Type.Union([
          Type.Literal("primary"),
          Type.Literal("standard"),
          Type.Literal("auxiliary"),
        ])),
      }),
      execute: async (_toolCallId, args, signal) => {
        const input = parseTaskArgs(args);
        const waitMs = input.waitTimeSeconds === undefined ? defaultWaitMs : Math.max(0, input.waitTimeSeconds * 1_000);

        if (input.taskId) {
          const existing = options.runner.get(input.taskId);
          if (!existing) {
            throw new Error(`Unknown Task: ${input.taskId}`);
          }
          if (
            delivered.has(input.taskId)
            && options.delivery?.isDeliveryVisible?.({
              task_id: input.taskId,
              eventId: delivered.get(input.taskId),
            })
          ) {
            return projectResult({
              status: "delivered",
              taskId: existing.taskId,
              childSessionId: existing.childSessionId,
              description: existing.description,
              eventId: delivered.get(input.taskId),
            });
          }

          trackWaiter(input.taskId, 1);
          try {
            const snapshot = await waitForSnapshot(options.runner, input.taskId, waitMs, signal);
            if (!isTerminal(snapshot.status)) {
              returnedRunning.add(snapshot.taskId);
              return projectResult({
                status: "running",
                taskId: snapshot.taskId,
                childSessionId: snapshot.childSessionId,
                description: snapshot.description,
              });
            }
            return projectResult(terminalResult(snapshot));
          } finally {
            trackWaiter(input.taskId, -1);
            const latest = options.runner.get(input.taskId);
            if (latest) {
              maybeDeliver(latest);
            }
          }
        }

        if (!input.prompt) {
          throw new Error("Task requires prompt when task_id is not provided");
        }
        if (!input.description) {
          throw new Error("Task requires description when starting a new subagent");
        }

        const started = await options.runner.start({
          prompt: input.prompt,
          description: input.description,
          role: input.role ?? "standard",
          signal,
          onUpdate: (snapshot) => {
            if (isTerminal(snapshot.status)) {
              maybeDeliver(snapshot);
            }
          },
        });

        trackWaiter(started.taskId, 1);
        try {
          const snapshot = await Promise.race([
            started.done,
            sleep(waitMs, signal).then(() => started.snapshot()),
          ]);
          if (!isTerminal(snapshot.status)) {
            returnedRunning.add(snapshot.taskId);
            void started.done.then((finalSnapshot) => maybeDeliver(finalSnapshot));
            return projectResult({
              status: "running",
              taskId: snapshot.taskId,
              childSessionId: snapshot.childSessionId,
              description: snapshot.description,
            });
          }
          return projectResult(terminalResult(snapshot));
        } finally {
          trackWaiter(started.taskId, -1);
          const latest = options.runner.get(started.taskId);
          if (latest) {
            maybeDeliver(latest);
          }
        }
      },
      hasActiveWork: () => options.runner.hasActiveWork(),
      detach: () => options.runner.detach(),
    }),
    defineTool({
      name: "TaskStop",
      description: "Stop a running subagent by task_id. Prefer this over attempting to cancel child processes directly.",
      parameters: Type.Object({
        task_id: Type.String(),
      }),
      execute: async (_toolCallId, args) => {
        const input = expectRecord(args);
        const taskId = expectString(input.task_id, "task_id");
        const snapshot = await options.runner.stop(taskId);
        return textResult(`Subagent stopped: ${taskId}`, {
          status: snapshot.status,
          task_id: snapshot.taskId,
          child_session_id: snapshot.childSessionId,
          description: snapshot.description,
          ...(snapshot.finalResult ? { result: snapshot.finalResult } : {}),
        });
      },
    }),
  ];
};

/** Last non-empty assistant text content from a message list (subagent final result). */
export const finalAssistantText = (messages: ScorelMessage[]): string | undefined => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== "assistant") {
      continue;
    }
    const text = message.content
      .filter((block): block is { type: "text"; text: string } => block.type === "text")
      .map((block) => block.text)
      .join("")
      .trim();
    if (text) {
      return text;
    }
  }
  return undefined;
};

const terminalResult = (snapshot: SubagentSnapshot): SubagentStartResult => {
  if (snapshot.status === "completed") {
    return {
      status: "completed",
      taskId: snapshot.taskId,
      childSessionId: snapshot.childSessionId,
      description: snapshot.description,
      result: snapshot.finalResult ?? "",
    };
  }
  if (snapshot.status === "cancelled") {
    return {
      status: "cancelled",
      taskId: snapshot.taskId,
      childSessionId: snapshot.childSessionId,
      description: snapshot.description,
      result: snapshot.finalResult,
    };
  }
  return {
    status: "failed",
    taskId: snapshot.taskId,
    childSessionId: snapshot.childSessionId,
    description: snapshot.description,
    errorMessage: snapshot.errorMessage ?? "Subagent failed",
  };
};

const isTerminal = (status: SubagentStatus): boolean =>
  status === "completed" || status === "failed" || status === "cancelled";

const waitForSnapshot = async (
  runner: SubagentRunner,
  taskId: string,
  waitMs: number,
  signal: AbortSignal,
): Promise<SubagentSnapshot> => {
  const startedAt = Date.now();
  while (true) {
    const snapshot = runner.get(taskId);
    if (!snapshot) {
      throw new Error(`Unknown Task: ${taskId}`);
    }
    if (isTerminal(snapshot.status) || waitMs <= 0 || Date.now() - startedAt >= waitMs || signal.aborted) {
      return snapshot;
    }
    await sleep(Math.min(50, waitMs), signal);
  }
};

const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (ms <= 0) {
      resolve();
      return;
    }
    if (signal?.aborted) {
      reject(new Error("aborted"));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error("aborted"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });

const parseTaskArgs = (args: unknown): {
  prompt?: string;
  description?: string;
  taskId?: string;
  waitTimeSeconds?: number;
  role?: ModelRole;
} => {
  const input = expectRecord(args);
  return {
    ...(typeof input.prompt === "string" ? { prompt: input.prompt } : {}),
    ...(typeof input.description === "string" ? { description: input.description } : {}),
    ...(typeof input.task_id === "string" ? { taskId: input.task_id } : {}),
    ...(typeof input.wait_time === "number" ? { waitTimeSeconds: input.wait_time } : {}),
    ...(input.role === "primary" || input.role === "standard" || input.role === "auxiliary"
      ? { role: input.role }
      : {}),
  };
};

const textResult = (text: string, details?: unknown): ToolResult => ({
  content: [{ type: "text", text }],
  ...(details === undefined ? {} : { details }),
});

const expectRecord = (value: unknown): Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("expected object args");
  }
  return value as Record<string, unknown>;
};

const expectString = (value: unknown, name: string): string => {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${name} must be a non-empty string`);
  }
  return value;
};
