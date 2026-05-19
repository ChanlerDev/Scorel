import { describe, expect, it } from "vitest";
import { formatRuntimeEvent, readPromptFromArgsOrStdin } from "./index.js";

describe("readPromptFromArgsOrStdin", () => {
  it("uses command line arguments when provided", async () => {
    await expect(readPromptFromArgsOrStdin(["hello", "world"], async () => "ignored")).resolves.toBe(
      "hello world"
    );
  });

  it("falls back to stdin when no arguments are provided", async () => {
    await expect(readPromptFromArgsOrStdin([], async () => "from stdin\n")).resolves.toBe("from stdin");
  });

  it("formats tool execution and runtime error events for stderr", () => {
    expect(
      formatRuntimeEvent({
        type: "tool_execution_start",
        sessionId: "test",
        toolCallId: "call_1",
        toolName: "read",
        args: { path: "package.json" }
      })
    ).toEqual([{ stream: "stderr", text: "[tool:start] read call_1\n" }]);

    expect(
      formatRuntimeEvent({
        type: "runtime_end",
        sessionId: "test",
        error: "provider failed"
      })
    ).toEqual([{ stream: "stderr", text: "[runtime:error] provider failed\n" }]);
  });
});
