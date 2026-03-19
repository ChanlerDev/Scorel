import { describe, it, expect } from "vitest";
import {
  TOOL_REGISTRY,
  getToolDefinitions,
  getToolEntry,
  requiresApproval,
  getToolTimeout,
  makeDeniedResult,
} from "../../src/main/core/tool-dispatch.js";
import type { ToolCall } from "../../src/shared/types.js";

describe("tool-dispatch", () => {
  it("TOOL_REGISTRY has 4 built-in tools", () => {
    expect(TOOL_REGISTRY.size).toBe(4);
    expect(TOOL_REGISTRY.has("bash")).toBe(true);
    expect(TOOL_REGISTRY.has("read_file")).toBe(true);
    expect(TOOL_REGISTRY.has("write_file")).toBe(true);
    expect(TOOL_REGISTRY.has("edit_file")).toBe(true);
  });

  it("getToolDefinitions returns provider-compatible definitions", () => {
    const defs = getToolDefinitions();
    expect(defs).toHaveLength(4);
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
    expect(requiresApproval(readCall)).toBe(false);
    expect(requiresApproval(bashCall)).toBe(true);
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
});
