import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("ScorelHost session lifecycle hooks", () => {
  it("routes first user-message side work through the after-user-message hook", async () => {
    const source = await readFile(join(process.cwd(), "src/index.ts"), "utf8");
    const runUserTurnStart = source.indexOf("async #runUserTurn(");
    const runUserTurnEnd = source.indexOf("\n  #scheduleAfterUserMessageHooks(", runUserTurnStart);
    const runUserTurn = source.slice(runUserTurnStart, runUserTurnEnd);

    expect(runUserTurn).toContain("this.#scheduleAfterUserMessageHooks(lane, clientId, userEvent)");
    expect(runUserTurn).toContain("void runAfterUserMessageHooks().catch");
    expect(runUserTurn).not.toContain("this.#maybeGenerateSessionTitle");
    expect(runUserTurn).not.toContain("await runAfterUserMessageHooks");

    const userAppendIndex = runUserTurn.indexOf("const userEvent = await this.#appendPersistent");
    const hookIndex = runUserTurn.indexOf("this.#scheduleAfterUserMessageHooks(lane, clientId, userEvent)");
    const runtimeIndex = runUserTurn.indexOf("lane.runtime.executeTurn");

    expect(userAppendIndex).toBeGreaterThanOrEqual(0);
    expect(hookIndex).toBeGreaterThan(userAppendIndex);
    expect(runtimeIndex).toBeGreaterThan(hookIndex);
  });

  it("serializes persistent appends so lifecycle hooks cannot race runtime events", async () => {
    const source = await readFile(join(process.cwd(), "src/index.ts"), "utf8");

    expect(source).toContain("appendQueue: Promise<void>");
    expect(source).toContain("const appendTask = lane.appendQueue.then");
    expect(source).toContain("lane.appendQueue = appendTask.catch");
  });
});
