import { describe, expect, it } from "vitest";

import { LinearTrackerClient } from "../src/linear.js";

const shouldRun =
  process.env.RUN_REAL_INTEGRATION === "1" &&
  Boolean(process.env.LINEAR_API_KEY) &&
  Boolean(process.env.LINEAR_PROJECT_SLUG);

const suite = shouldRun ? describe : describe.skip;

suite("real integration smoke", () => {
  it("fetches candidate issues from Linear", async () => {
    const client = new LinearTrackerClient({
      kind: "linear",
      endpoint: "https://api.linear.app/graphql",
      apiKey: process.env.LINEAR_API_KEY ?? null,
      projectSlug: process.env.LINEAR_PROJECT_SLUG ?? null,
      activeStates: ["Todo", "In Progress"],
      terminalStates: ["Done", "Closed", "Cancelled"]
    });

    const issues = await client.fetchCandidateIssues();
    expect(Array.isArray(issues)).toBe(true);
  }, 30_000);
});
