import { describe, it, expect } from "vitest";
import {
  TOOL_REGISTRY,
  getToolDefinitions,
  getToolEntry,
  registerMcpTools,
  requiresApproval,
  getToolTimeout,
  makeDeniedResult,
  resolveToolApproval,
  unregisterMcpTools,
} from "../../src/main/core/tool-dispatch.js";
import type { ToolCall } from "../../src/shared/types.js";

describe("tool-dispatch", () => {
  it("TOOL_REGISTRY has 7 built-in tools", () => {
    expect(TOOL_REGISTRY.size).toBe(7);
    expect(TOOL_REGISTRY.has("bash")).toBe(true);
    expect(TOOL_REGISTRY.has("read_file")).toBe(true);
    expect(TOOL_REGISTRY.has("write_file")).toBe(true);
    expect(TOOL_REGISTRY.has("edit_file")).toBe(true);
    expect(TOOL_REGISTRY.has("load_skill")).toBe(true);
    expect(TOOL_REGISTRY.has("subagent")).toBe(true);
    expect(TOOL_REGISTRY.has("todo_write")).toBe(true);
  });

  it("getToolDefinitions returns provider-compatible definitions", () => {
    const defs = getToolDefinitions({
      includeLoadSkill: true,
      includeSubagent: true,
      includeTodoWrite: true,
    });
    expect(defs).toHaveLength(7);
    for (const def of defs) {
      expect(def.type).toBe("function");
      expect(def.function.name).toBeTruthy();
      expect(def.function.description).toBeTruthy();
      expect(def.function.parameters).toBeTruthy();
    }
  });

  it("getToolEntry returns entry for known tools", () => {
    expect(getToolEntry("bash")).toBeDefined();
    expect(getToolEntry("unknown")).toBeUndefined();
  });

  it("requiresApproval: read_file=false, bash=true", () => {
    const readCall: ToolCall = { toolCallId: "tc-1", name: "read_file", arguments: {} };
    const bashCall: ToolCall = { toolCallId: "tc-2", name: "bash", arguments: {} };
    const skillCall: ToolCall = { toolCallId: "tc-3", name: "load_skill", arguments: { name: "code-review" } };
    const todoCall: ToolCall = { toolCallId: "tc-4", name: "todo_write", arguments: { operation: "list" } };
    expect(requiresApproval(readCall)).toBe(false);
    expect(requiresApproval(bashCall)).toBe(true);
    expect(requiresApproval(skillCall)).toBe(false);
    expect(requiresApproval(todoCall)).toBe(false);
  });

  it("getToolTimeout respects bash custom timeout_ms", () => {
    const bashCall: ToolCall = {
      toolCallId: "tc-1",
      name: "bash",
      arguments: { timeout_ms: 60_000 },
    };
    expect(getToolTimeout(bashCall)).toBe(60_000);

    const bashMax: ToolCall = {
      toolCallId: "tc-2",
      name: "bash",
      arguments: { timeout_ms: 999_999 },
    };
    expect(getToolTimeout(bashMax)).toBe(300_000); // capped
  });

  it("makeDeniedResult produces error result", () => {
    const tc: ToolCall = { toolCallId: "tc-d", name: "bash", arguments: {} };
    const result = makeDeniedResult(tc);
    expect(result.toolCallId).toBe("tc-d");
    expect(result.isError).toBe(true);
    expect(result.content).toBe("Tool call denied by user");
  });

  it("getToolDefinitions can expose only load_skill when runner tools are unavailable", () => {
    const defs = getToolDefinitions({ includeRunnerTools: false, includeLoadSkill: true });
    expect(defs).toHaveLength(1);
    expect(defs[0].function.name).toBe("load_skill");
  });

  it("can expose subagent and todo_write without runner tools", () => {
    const defs = getToolDefinitions({
      includeRunnerTools: false,
      includeSubagent: true,
      includeTodoWrite: true,
    });
    expect(defs.map((def) => def.function.name).sort()).toEqual(["subagent", "todo_write"]);
  });

  it("does not expose load_skill unless explicitly requested", () => {
    const defs = getToolDefinitions();
    expect(defs.map((def) => def.function.name)).not.toContain("load_skill");
  });

  it("falls back to tool registry defaults when permissions are unset", () => {
    const readCall: ToolCall = { toolCallId: "tc-read", name: "read_file", arguments: { path: "a.txt" } };
    const bashCall: ToolCall = { toolCallId: "tc-bash", name: "bash", arguments: { command: "pwd" } };

    expect(resolveToolApproval(readCall, null, null)).toEqual({ action: "allow" });
    expect(resolveToolApproval(bashCall, null, null)).toEqual({ action: "confirm" });
  });

  it("registers and unregisters MCP tools dynamically", () => {
    registerMcpTools("server-1", "filesystem", [
      {
        name: "read_text",
        description: "Read a text file",
        inputSchema: {
          type: "object",
          properties: {
            path: { type: "string" },
          },
          required: ["path"],
        },
      },
    ]);

    expect(getToolEntry("filesystem.read_text")).toMatchObject({
      name: "filesystem.read_text",
      source: "mcp",
      serverId: "server-1",
      mcpToolName: "read_text",
    });
    expect(getToolDefinitions().map((definition) => definition.function.name)).toContain("filesystem.read_text");
    expect(resolveToolApproval({
      toolCallId: "tc-mcp",
      name: "filesystem.read_text",
      arguments: { path: "README.md" },
    }, null, null)).toEqual({ action: "confirm" });

    unregisterMcpTools("server-1");

    expect(getToolEntry("filesystem.read_text")).toBeUndefined();
  });
});
