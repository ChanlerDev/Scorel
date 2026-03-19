import type { ToolName, ToolCall, ToolResult } from "../../shared/types.js";
import type { ToolDefinition } from "../provider/types.js";
import { DEFAULT_TOOL_TIMEOUT_MS } from "../../shared/constants.js";

export type ApprovalPolicy = "allow" | "confirm";

export type ToolEntry = {
  name: ToolName;
  schema: Record<string, unknown>;
  approval: ApprovalPolicy;
  timeoutMs: number;
};

const bashSchema = {
  type: "object",
  properties: {
    command: { type: "string", description: "The shell command to execute" },
    timeout_ms: {
      type: "number",
      description: "Timeout in milliseconds (default 30000, max 300000)",
    },
  },
  required: ["command"],
};

const readFileSchema = {
  type: "object",
  properties: {
    path: { type: "string", description: "File path relative to workspace root" },
    offset: { type: "number", description: "Line offset (0-based)" },
    limit: { type: "number", description: "Number of lines to read" },
  },
  required: ["path"],
};

const writeFileSchema = {
  type: "object",
  properties: {
    path: { type: "string", description: "File path relative to workspace root" },
    content: { type: "string", description: "File content to write" },
  },
  required: ["path", "content"],
};

const editFileSchema = {
  type: "object",
  properties: {
    path: { type: "string", description: "File path relative to workspace root" },
    old_string: { type: "string", description: "Exact string to find (must be unique)" },
    new_string: { type: "string", description: "Replacement string" },
  },
  required: ["path", "old_string", "new_string"],
};

export const TOOL_REGISTRY = new Map<string, ToolEntry>([
  ["bash", { name: "bash", schema: bashSchema, approval: "confirm", timeoutMs: DEFAULT_TOOL_TIMEOUT_MS }],
  ["read_file", { name: "read_file", schema: readFileSchema, approval: "allow", timeoutMs: 10_000 }],
  ["write_file", { name: "write_file", schema: writeFileSchema, approval: "confirm", timeoutMs: 10_000 }],
  ["edit_file", { name: "edit_file", schema: editFileSchema, approval: "confirm", timeoutMs: 10_000 }],
]);

export function getToolDefinitions(): ToolDefinition[] {
  const defs: ToolDefinition[] = [];
  for (const entry of TOOL_REGISTRY.values()) {
    defs.push({
      type: "function",
      function: {
        name: entry.name,
        description: getToolDescription(entry.name),
        parameters: entry.schema,
      },
    });
  }
  return defs;
}

function getToolDescription(name: ToolName): string {
  switch (name) {
    case "bash":
      return "Execute a shell command in the workspace directory. Returns stdout+stderr combined output.";
    case "read_file":
      return "Read a file from the workspace. Supports line offset and limit for partial reads.";
    case "write_file":
      return "Write content to a file in the workspace. Creates parent directories if needed.";
    case "edit_file":
      return "Edit a file by replacing an exact string match. The old_string must appear exactly once.";
    case "load_skill":
      return "Load a skill file (reserved for M4).";
  }
}

export function getToolEntry(name: string): ToolEntry | undefined {
  return TOOL_REGISTRY.get(name);
}

export function requiresApproval(toolCall: ToolCall): boolean {
  const entry = TOOL_REGISTRY.get(toolCall.name);
  if (!entry) return true; // Unknown tools require approval
  return entry.approval === "confirm";
}

export function getToolTimeout(toolCall: ToolCall): number {
  const entry = TOOL_REGISTRY.get(toolCall.name);
  if (!entry) return DEFAULT_TOOL_TIMEOUT_MS;

  // bash supports custom timeout via args
  if (toolCall.name === "bash" && typeof toolCall.arguments.timeout_ms === "number") {
    return Math.min(toolCall.arguments.timeout_ms, 300_000);
  }

  return entry.timeoutMs;
}

export function makeDeniedResult(toolCall: ToolCall): ToolResult {
  return {
    toolCallId: toolCall.toolCallId,
    isError: true,
    content: "Tool call denied by user",
  };
}
