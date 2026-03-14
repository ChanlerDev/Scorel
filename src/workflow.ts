import { readFile } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";

import { SymphonyError } from "./errors.js";
import type { WorkflowDefinition } from "./types.js";

export async function loadWorkflow(workflowPath?: string): Promise<WorkflowDefinition> {
  const resolvedPath = path.resolve(workflowPath ?? path.join(process.cwd(), "WORKFLOW.md"));

  let raw: string;
  try {
    raw = await readFile(resolvedPath, "utf8");
  } catch (error) {
    throw new SymphonyError(
      "missing_workflow_file",
      `Unable to read workflow file at ${resolvedPath}`,
      error
    );
  }

  const { frontMatter, body } = splitFrontMatter(raw);
  let config: Record<string, unknown> = {};

  if (frontMatter !== null) {
    let parsed: unknown;
    try {
      parsed = parseYaml(frontMatter);
    } catch (error) {
      throw new SymphonyError("workflow_parse_error", "Failed to parse workflow front matter", error);
    }

    if (parsed !== undefined && (parsed === null || Array.isArray(parsed) || typeof parsed !== "object")) {
      throw new SymphonyError(
        "workflow_front_matter_not_a_map",
        "Workflow front matter must decode to a YAML object"
      );
    }

    config = (parsed as Record<string, unknown> | undefined) ?? {};
  }

  return {
    config,
    promptTemplate: body.trim(),
    path: resolvedPath
  };
}

function splitFrontMatter(raw: string): { frontMatter: string | null; body: string } {
  if (!raw.startsWith("---")) {
    return { frontMatter: null, body: raw };
  }

  const lines = raw.split(/\r?\n/);
  if (lines[0] !== "---") {
    return { frontMatter: null, body: raw };
  }

  const endIndex = lines.findIndex((line, index) => index > 0 && line === "---");
  if (endIndex === -1) {
    throw new SymphonyError("workflow_parse_error", "Workflow front matter is missing a closing delimiter");
  }

  return {
    frontMatter: lines.slice(1, endIndex).join("\n"),
    body: lines.slice(endIndex + 1).join("\n")
  };
}
