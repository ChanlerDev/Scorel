import { describe, expect, it } from "vitest";

import { asSessionId } from "@scorel/protocol";

import {
  createSubagentTools,
  type SubagentRunner,
  type SubagentSnapshot,
  type SubagentStatus,
} from "./subagent-tools.js";

const textOf = (result: { content: Array<{ type: string; text?: string }> }): string =>
  result.content.map((block) => (block.type === "text" ? block.text ?? "" : "")).join("");

const toolByName = (runner: SubagentRunner, name: string, delivery?: Parameters<typeof createSubagentTools>[0]["delivery"]) => {
  const tool = createSubagentTools({ runner, defaultWaitTimeSeconds: 1, delivery }).find((entry) => entry.name === name);
  if (!tool) {
    throw new Error(`missing tool ${name}`);
  }
  return tool;
};

const createFakeRunner = (): SubagentRunner & {
  tasks: Map<string, {
    snapshot: SubagentSnapshot;
    resolve: (snapshot: SubagentSnapshot) => void;
    done: Promise<SubagentSnapshot>;
  }>;
  complete: (taskId: string, result: string, status?: SubagentStatus) => void;
} => {
  const tasks = new Map<string, {
    snapshot: SubagentSnapshot;
    resolve: (snapshot: SubagentSnapshot) => void;
    done: Promise<SubagentSnapshot>;
  }>();
  let counter = 0;

  const runner: SubagentRunner & {
    tasks: typeof tasks;
    complete: (taskId: string, result: string, status?: SubagentStatus) => void;
  } = {
    tasks,
    hasActiveWork: () => [...tasks.values()].some((task) => task.snapshot.status === "running" || task.snapshot.status === "queued"),
    detach: async () => undefined,
    get: (taskId) => tasks.get(taskId)?.snapshot,
    stop: async (taskId) => {
      const task = tasks.get(taskId);
      if (!task) {
        throw new Error(`Unknown Task: ${taskId}`);
      }
      task.snapshot = {
        ...task.snapshot,
        status: "cancelled",
        finalResult: task.snapshot.finalResult ?? "stopped",
      };
      task.resolve(task.snapshot);
      return task.snapshot;
    },
    complete: (taskId, result, status = "completed") => {
      const task = tasks.get(taskId);
      if (!task) {
        throw new Error(`Unknown Task: ${taskId}`);
      }
      task.snapshot = {
        ...task.snapshot,
        status,
        finalResult: result,
        events: [
          ...task.snapshot.events,
          { seq: task.snapshot.lastSeq + 1, type: "assistant_message", role: "assistant", text: result },
        ],
        lastSeq: task.snapshot.lastSeq + 1,
      };
      task.resolve(task.snapshot);
    },
    start: async (input) => {
      counter += 1;
      const taskId = `task_${counter}`;
      const childSessionId = asSessionId(`ses_sub_${counter}`);
      let resolve!: (snapshot: SubagentSnapshot) => void;
      const done = new Promise<SubagentSnapshot>((res) => {
        resolve = res;
      });
      const snapshot: SubagentSnapshot = {
        taskId,
        childSessionId,
        description: input.description,
        status: "running",
        prompt: input.prompt,
        role: input.role,
        events: [{ seq: 1, type: "user_message", role: "user", text: input.prompt }],
        lastSeq: 1,
      };
      tasks.set(taskId, { snapshot, resolve, done });
      return {
        taskId,
        childSessionId,
        done,
        stop: async () => {
          await runner.stop(taskId);
        },
        snapshot: () => tasks.get(taskId)!.snapshot,
      };
    },
  };
  return runner;
};

describe("createSubagentTools", () => {
  it("returns only the last assistant message when Task completes within wait_time", async () => {
    const runner = createFakeRunner();
    const task = toolByName(runner, "Task");
    const pending = task.execute(
      "call_sync",
      { prompt: "summarize auth", description: "Auth summary", wait_time: 1 },
      new AbortController().signal,
      () => undefined,
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
    const started = [...runner.tasks.keys()][0]!;
    runner.complete(started, "auth uses JWT");
    const result = await pending;
    expect(textOf(result)).toBe("auth uses JWT");
    expect(textOf(result)).not.toContain("summarize auth");
    expect(result.details).toMatchObject({ status: "completed", task_id: started });
  });

  it("returns a running task_id when wait_time elapses and later resolves through Task with wait_time", async () => {
    const runner = createFakeRunner();
    const task = toolByName(runner, "Task");
    const started = await task.execute(
      "call_async",
      { prompt: "long research", description: "Long research", wait_time: 0 },
      new AbortController().signal,
      () => undefined,
    );
    expect(textOf(started)).toContain("status: running");
    const taskId = (started.details as { task_id?: string }).task_id;
    expect(taskId).toMatch(/^task_/);

    setTimeout(() => runner.complete(taskId!, "done later"), 20);
    const finished = await task.execute(
      "call_async_poll",
      { task_id: taskId, wait_time: 1 },
      new AbortController().signal,
      () => undefined,
    );
    expect(textOf(finished)).toBe("done later");
    expect(finished.details).toMatchObject({ status: "completed", task_id: taskId });
  });

  it("does not expose ReadThread or incremental transcript modes", () => {
    const runner = createFakeRunner();
    const names = createSubagentTools({ runner }).map((tool) => tool.name);
    expect(names).toEqual(["Task", "TaskStop"]);
  });

  it("stops a running subagent through TaskStop", async () => {
    const runner = createFakeRunner();
    const task = toolByName(runner, "Task");
    const stop = toolByName(runner, "TaskStop");
    const started = await task.execute(
      "call_stop",
      { prompt: "stop me", description: "Stop me", wait_time: 0 },
      new AbortController().signal,
      () => undefined,
    );
    const taskId = (started.details as { task_id: string }).task_id;
    const stopped = await stop.execute(
      "call_stop_now",
      { task_id: taskId },
      new AbortController().signal,
      () => undefined,
    );
    expect(textOf(stopped)).toContain("Subagent stopped");
    expect(runner.get(taskId)?.status).toBe("cancelled");
  });

  it("returns a delivered advisory after completion reminder remains visible", async () => {
    const runner = createFakeRunner();
    let delivered = false;
    const task = toolByName(runner, "Task", {
      onComplete: async () => {
        delivered = true;
        return { eventId: "evt_sub" };
      },
      isDeliveryVisible: () => delivered,
    });
    const started = await task.execute(
      "call_delivered",
      { prompt: "deliver me", description: "Deliver me", wait_time: 0 },
      new AbortController().signal,
      () => undefined,
    );
    const taskId = (started.details as { task_id: string }).task_id;
    runner.complete(taskId, "delivered result");
    await new Promise((resolve) => setTimeout(resolve, 20));
    const polled = await task.execute(
      "call_delivered_poll",
      { task_id: taskId, wait_time: 0 },
      new AbortController().signal,
      () => undefined,
    );
    expect(textOf(polled)).toContain("already been injected through a system reminder");
    expect(textOf(polled)).not.toContain("delivered result");
  });
});
