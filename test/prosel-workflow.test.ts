import path from "node:path";

import { describe, expect, it } from "vitest";

import { resolveConfig } from "../src/config.js";
import { loadWorkflow } from "../src/workflow.js";

describe("Prosel workflow", () => {
  it("only dispatches In Progress issues and limits concurrency to one", async () => {
    const workflow = await loadWorkflow(path.resolve("WORKFLOW.md"));
    const config = resolveConfig(workflow, {
      ...process.env,
      LINEAR_API_KEY: "test-key"
    });

    expect(config.tracker.activeStates).toEqual(["In Progress"]);
    expect(config.agent.maxConcurrentAgents).toBe(1);
  });
});
