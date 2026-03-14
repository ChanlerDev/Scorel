import { describe, expect, it } from "vitest";

import { normalizeIssue } from "../src/linear.js";

describe("linear normalization", () => {
  it("normalizes labels and blockers", () => {
    const issue = normalizeIssue({
      id: "1",
      identifier: "ABC-1",
      title: "Test",
      description: "desc",
      priority: 2,
      branchName: "feature/abc-1",
      url: "https://example.com",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T01:00:00Z",
      state: { name: "Todo" },
      labels: { nodes: [{ name: "Bug" }, { name: "P0" }] },
      inverseRelations: {
        nodes: [
          { type: "blocks", issue: { id: "2", identifier: "ABC-2", state: { name: "In Progress" } } },
          { type: "relates", issue: { id: "3", identifier: "ABC-3", state: { name: "Done" } } }
        ]
      }
    });

    expect(issue.labels).toEqual(["bug", "p0"]);
    expect(issue.blocked_by).toEqual([{ id: "2", identifier: "ABC-2", state: "In Progress" }]);
  });
});
