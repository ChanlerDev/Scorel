import type {
  BuiltInToolName,
  McpToolDefinition,
  ToolCall,
  ToolResult,
  PermissionConfig,
} from "../../shared/types.js";
import type { ToolDefinition } from "../provider/types.js";
import { DEFAULT_TOOL_TIMEOUT_MS } from "../../shared/constants.js";
import { resolvePermission, makeDeniedWithReasonResult } from "../security/permission.js";

export type ApprovalPolicy = "allow" | "confirm";
export type ToolSource = "builtin" | "mcp";
export type ToolBackend = "runner" | "local" | "mcp";

export type ToolEntry = {
  name: string;
  schema: Record<string, unknown>;
  approval: ApprovalPolicy;
  timeoutMs: number;
  description?: string;
  source: ToolSource;
  backend: ToolBackend;
  serverId?: string;
  mcpToolName?: string;
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
    path: { type: "string", description: "File path; relative paths resolve from the current workspace, absolute paths are allowed" },
    offset: { type: "number", description: "Line offset (0-based)" },
    limit: { type: "number", description: "Number of lines to read" },
  },
  required: ["path"],
};

const writeFileSchema = {
  type: "object",
  properties: {
    path: { type: "string", description: "File path; relative paths resolve from the current workspace, absolute paths are allowed" },
    content: { type: "string", description: "File content to write" },
  },
  required: ["path", "content"],
};

const editFileSchema = {
  type: "object",
  properties: {
    path: { type: "string", description: "File path; relative paths resolve from the current workspace, absolute paths are allowed" },
    old_string: { type: "string", description: "Exact string to find (must be unique)" },
    new_string: { type: "string", description: "Replacement string" },
  },
  required: ["path", "old_string", "new_string"],
};

const loadSkillSchema = {
  type: "object",
  properties: {
    name: {
      type: "string",
      description: 'The skill name to load, or "list" to see available skills',
    },
  },
  required: ["name"],
};

const subagentSchema = {
  type: "object",
  properties: {
    task: { type: "string", description: "Task description for the child agent" },
    max_turns: { type: "number", description: "Max conversation turns (default 20)" },
  },
  required: ["task"],
};

const todoWriteSchema = {
  type: "object",
  properties: {
    operation: { type: "string", enum: ["create", "update", "delete", "list"], description: "Operation to perform" },
    id: { type: "string", description: "Task ID (required for update/delete)" },
    title: { type: "string", description: "Task title (required for create)" },
    status: { type: "string", enum: ["pending", "in_progress", "done"], description: "Task status" },
    notes: { type: "string", description: "Optional notes or details" },
  },
  required: ["operation"],
};

export const TOOL_REGISTRY = new Map<string, ToolEntry>([
  ["bash", { name: "bash", schema: bashSchema, approval: "confirm", timeoutMs: DEFAULT_TOOL_TIMEOUT_MS, source: "builtin", backend: "runner" }],
  ["read_file", { name: "read_file", schema: readFileSchema, approval: "allow", timeoutMs: 10_000, source: "builtin", backend: "runner" }],
  ["write_file", { name: "write_file", schema: writeFileSchema, approval: "confirm", timeoutMs: 10_000, source: "builtin", backend: "runner" }],
  ["edit_file", { name: "edit_file", schema: editFileSchema, approval: "confirm", timeoutMs: 10_000, source: "builtin", backend: "runner" }],
  ["load_skill", { name: "load_skill", schema: loadSkillSchema, approval: "allow", timeoutMs: 5_000, source: "builtin", backend: "local" }],
  ["subagent", { name: "subagent", schema: subagentSchema, approval: "confirm", timeoutMs: 600_000, source: "builtin", backend: "local" }],
  ["todo_write", { name: "todo_write", schema: todoWriteSchema, approval: "allow", timeoutMs: 5_000, source: "builtin", backend: "local" }],
]);

export function qualifyMcpToolName(serverName: string, toolName: string): string {
  return `${serverName}.${toolName}`;
}

export function registerMcpTools(
  serverId: string,
  serverName: string,
  tools: McpToolDefinition[],
): void {
  unregisterMcpTools(serverId);
  for (const tool of tools) {
    const qualifiedName = qualifyMcpToolName(serverName, tool.name);
    TOOL_REGISTRY.set(qualifiedName, {
      name: qualifiedName,
      schema: tool.inputSchema,
      approval: "confirm",
      timeoutMs: DEFAULT_TOOL_TIMEOUT_MS,
      description: tool.description,
      source: "mcp",
      backend: "mcp",
      serverId,
      mcpToolName: tool.name,
    });
  }
}

export function unregisterMcpTools(serverId: string): void {
  for (const [name, entry] of TOOL_REGISTRY.entries()) {
    if (entry.source === "mcp" && entry.serverId === serverId) {
      TOOL_REGISTRY.delete(name);
    }
  }
}

export function getToolDefinitions(opts?: {
  includeRunnerTools?: boolean;
  includeLoadSkill?: boolean;
  includeSubagent?: boolean;
  includeTodoWrite?: boolean;
  includeMcpTools?: boolean;
}): ToolDefinition[] {
  const includeRunnerTools = opts?.includeRunnerTools ?? true;
  const includeLoadSkill = opts?.includeLoadSkill ?? false;
  const includeSubagent = opts?.includeSubagent ?? false;
  const includeTodoWrite = opts?.includeTodoWrite ?? false;
  const includeMcpTools = opts?.includeMcpTools ?? true;
  const defs: ToolDefinition[] = [];
  for (const entry of TOOL_REGISTRY.values()) {
    const isRunnerTool = entry.backend === "runner";
    const isLoadSkill = entry.name === "load_skill";
    const isSubagent = entry.name === "subagent";
    const isTodoWrite = entry.name === "todo_write";
    const isMcpTool = entry.backend === "mcp";

    if (isRunnerTool && !includeRunnerTools) continue;
    if (isLoadSkill && !includeLoadSkill) continue;
    if (isSubagent && !includeSubagent) continue;
    if (isTodoWrite && !includeTodoWrite) continue;
    if (isMcpTool && !includeMcpTools) continue;

    defs.push({
      type: "function",
      function: {
        name: entry.name,
        description: getToolDescription(entry),
        parameters: entry.schema,
      },
    });
  }
  return defs;
}

function getToolDescription(entry: ToolEntry): string {
  if (entry.description) {
    return entry.description;
  }

  switch (entry.name as BuiltInToolName) {
    case "bash":
      return "Execute a shell command using the current workspace as the default working directory. Returns stdout+stderr combined output.";
    case "read_file":
      return "Read a file. Relative paths resolve from the current workspace; absolute paths are allowed. Supports line offset and limit for partial reads.";
    case "write_file":
      return "Write content to a file. Relative paths resolve from the current workspace; absolute paths are allowed. Creates parent directories if needed.";
    case "edit_file":
      return "Edit a file by replacing an exact string match. Relative paths resolve from the current workspace; absolute paths are allowed. The old_string must appear exactly once.";
    case "load_skill":
      return "Load a skill file to get detailed instructions for a specific task. Use 'list' as the name to see available skills.";
    case "subagent":
      return "Spawn an isolated child conversation to perform a subtask. The child has access to all tools but runs in a separate context. Returns a summary of the child's work.";
    case "todo_write":
      return "Create, update, delete, or list structured todo items for tracking multi-step task progress.";
    default:
      return "Call an MCP tool exposed by a connected server.";
  }
}

export function getToolEntry(name: string): ToolEntry | undefined {
  return TOOL_REGISTRY.get(name);
}

export function requiresApproval(toolCall: ToolCall): boolean {
  const entry = TOOL_REGISTRY.get(toolCall.name);
  if (!entry) return true;
  return entry.approval === "confirm";
}

export function resolveToolApproval(
  toolCall: ToolCall,
  sessionPermissions: PermissionConfig | null,
  globalPermissions: PermissionConfig | null,
): { action: "allow" | "confirm" | "deny"; reason?: string } {
  const { level, reason } = resolvePermission(
    toolCall.name,
    sessionPermissions,
    globalPermissions,
  );

  if (level === "allow") return { action: "allow" };
  if (level === "deny") return { action: "deny", reason };

  const entry = TOOL_REGISTRY.get(toolCall.name);
  if (!entry) return { action: "confirm" };

  return { action: entry.approval === "allow" ? "allow" : "confirm" };
}

export function makePolicyDeniedResult(
  toolCall: ToolCall,
  reason?: string,
): ToolResult {
  return makeDeniedWithReasonResult(toolCall.toolCallId, reason);
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
