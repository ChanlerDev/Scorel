import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { resolveConfig } from "../src/config.js";
import { SymphonyError } from "../src/errors.js";
import { renderPrompt } from "../src/template.js";
import type { Issue } from "../src/types.js";
import { loadWorkflow } from "../src/workflow.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("workflow loader and template", () => {
  it("loads YAML front matter and resolves env indirection", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "scorel-workflow-"));
    tempDirs.push(dir);
    const workflowPath = path.join(dir, "WORKFLOW.md");

    await writeFile(
      workflowPath,
      `---
tracker:
  kind: linear
  api_key: $LINEAR_API_KEY
  project_slug: scorel
workspace:
  root: ./workspaces
---
Issue {{ issue.identifier }}`
    );

    const workflow = await loadWorkflow(workflowPath);
    const config = resolveConfig(workflow, {
      ...process.env,
      LINEAR_API_KEY: "secret-token"
    });

    expect(workflow.promptTemplate).toContain("Issue");
    expect(config.tracker.apiKey).toBe("secret-token");
    expect(config.workspace.root).toContain("workspaces");
  });

  it("fails rendering on unknown variables", async () => {
    const issue = makeIssue();

    await expect(renderPrompt("{{ issue.missing_field }}", issue, null)).rejects.toMatchObject({
      code: "template_render_error"
    });
  });
});

function makeIssue(): Issue {
  return {
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
}
