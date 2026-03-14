import { describe, expect, it } from "vitest";

import { Orchestrator, sortIssuesForDispatch } from "../src/orchestrator.js";
import type { Issue, TrackerClient, WorkflowDefinition } from "../src/types.js";

describe("orchestrator helpers", () => {
  it("sorts by priority then oldest created time", () => {
    const sorted = sortIssuesForDispatch([
      makeIssue({ id: "2", identifier: "ABC-2", priority: 2, created_at: new Date("2026-01-02T00:00:00Z") }),
      makeIssue({ id: "1", identifier: "ABC-1", priority: 1, created_at: new Date("2026-01-03T00:00:00Z") }),
      makeIssue({ id: "3", identifier: "ABC-3", priority: 1, created_at: new Date("2026-01-01T00:00:00Z") })
    ]);

    expect(sorted.map((issue) => issue.identifier)).toEqual(["ABC-3", "ABC-1", "ABC-2"]);
  });

  it("does not dispatch Todo issues with active blockers", () => {
    const orchestrator = new Orchestrator(workflow(), config(), tracker());
    const blocked = makeIssue({
      blocked_by: [{ id: "9", identifier: "ABC-9", state: "In Progress" }]
    });

    expect((orchestrator as any).shouldDispatch(blocked)).toBe(false);
    expect((orchestrator as any).shouldDispatch(makeIssue())).toBe(true);
  });
});

function workflow(): WorkflowDefinition {
  return {
    config: {},
    promptTemplate: "Issue {{ issue.identifier }}",
    path: "/tmp/WORKFLOW.md"
  };
}

function config() {
  return {
    tracker: {
      kind: "linear" as const,
      endpoint: "https://api.linear.app/graphql",
      apiKey: "token",
      projectSlug: "scorel",
      activeStates: ["Todo", "In Progress"],
      terminalStates: ["Done", "Closed"]
    },
    polling: { intervalMs: 30_000 },
    workspace: { root: "/tmp/scorel-workspaces" },
    hooks: {
      afterCreate: null,
      beforeRun: null,
      afterRun: null,
      beforeRemove: null,
      timeoutMs: 5_000
    },
    agent: {
      maxConcurrentAgents: 10,
      maxRetryBackoffMs: 300_000,
      maxTurns: 20,
      maxConcurrentAgentsByState: {}
    },
    codex: {
      command: "codex app-server",
      turnTimeoutMs: 3_600_000,
      readTimeoutMs: 5_000,
      stallTimeoutMs: 300_000
    },
    server: {}
  };
}

function tracker(): TrackerClient {
  return {
    fetchCandidateIssues: async () => [],
    fetchIssuesByStates: async () => [],
    fetchIssueStatesByIds: async () => []
  };
}

function makeIssue(overrides: Partial<Issue> = {}): Issue {
  const base: Issue = {
    id: "1",
    identifier: "ABC-1",
    title: "Test",
    description: null,
    priority: 1,
    state: "Todo",
    branch_name: null,
    url: null,
    labels: [],
    blocked_by: [],
    created_at: new Date("2026-01-01T00:00:00Z"),
    updated_at: new Date("2026-01-01T00:00:00Z")
  };

  return {
    ...base,
    ...overrides,
    created_at: overrides.created_at ?? base.created_at,
    updated_at: overrides.updated_at ?? base.updated_at
  };
}
