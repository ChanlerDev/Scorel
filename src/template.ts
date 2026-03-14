import { Liquid } from "liquidjs";

import { SymphonyError } from "./errors.js";
import type { Issue } from "./types.js";

const engine = new Liquid({
  strictFilters: true,
  strictVariables: true
});

export async function renderPrompt(
  template: string,
  issue: Issue,
  attempt: number | null
): Promise<string> {
  const body = template.trim() || "You are working on an issue from Linear.";

  try {
    const rendered = await engine.parseAndRender(body, {
      issue: serializeIssue(issue),
      attempt
    });
    return rendered.trim();
  } catch (error) {
    const message =
      error instanceof Error && error.name.includes("Parse")
        ? "template_parse_error"
        : "template_render_error";
    throw new SymphonyError(message, "Failed to render workflow prompt template", error);
  }
}

function serializeIssue(issue: Issue): Record<string, unknown> {
  return {
    ...issue,
    created_at: issue.created_at?.toISOString() ?? null,
    updated_at: issue.updated_at?.toISOString() ?? null
  };
}
