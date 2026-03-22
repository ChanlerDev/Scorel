import type { PermissionConfig, PermissionLevel, ToolResult } from "../../shared/types.js";

export const DEFAULT_PERMISSION_CONFIG: PermissionConfig = {
  fullAccess: false,
  toolDefaults: {},
  denyReasons: {},
};

export function resolvePermission(
  toolName: string,
  sessionConfig: PermissionConfig | null,
  globalConfig: PermissionConfig | null,
): { level?: PermissionLevel; reason?: string } {
  const session = sessionConfig ?? DEFAULT_PERMISSION_CONFIG;
  const global = globalConfig ?? DEFAULT_PERMISSION_CONFIG;

  // full_access overrides everything except subagent
  if (session.fullAccess && toolName !== "subagent") {
    return { level: "allow" };
  }

  // Session-level override
  if (toolName in session.toolDefaults) {
    const level = session.toolDefaults[toolName];
    return { level, reason: session.denyReasons[toolName] };
  }

  // Global default
  if (toolName in global.toolDefaults) {
    const level = global.toolDefaults[toolName];
    return { level, reason: global.denyReasons[toolName] };
  }

  // Fallback: return undefined level to let caller use tool registry default
  return {};
}

export function makeDeniedWithReasonResult(
  toolCallId: string,
  reason?: string,
): ToolResult {
  return {
    toolCallId,
    isError: true,
    content: reason
      ? `Tool call denied by policy: ${reason}`
      : "Tool call denied by policy",
  };
}
