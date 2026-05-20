import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  createCliTools,
  formatHistory,
  formatRuntimeEvent,
  parseCliArgs,
  parsePromptCommand,
  runSlashCommand,
  readPromptFromArgsOrStdin,
  shouldStartInteractiveShell
} from "./index.js";
import type { AssistantMessage } from "@scorel/core/llm";

function assistantMessage(text: string, timestamp: number): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    api: "openai-responses",
    provider: "openai",
    model: "test",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
    },
    stopReason: "stop",
    timestamp
  };
}

describe("readPromptFromArgsOrStdin", () => {
  it("uses command line arguments when provided", async () => {
    await expect(readPromptFromArgsOrStdin(["hello", "world"], async () => "ignored")).resolves.toBe(
      "hello world"
    );
  });

  it("falls back to stdin when no arguments are provided", async () => {
    await expect(readPromptFromArgsOrStdin([], async () => "from stdin\n")).resolves.toBe("from stdin");
  });

  it("parses session flags separately from prompt text", () => {
    expect(parseCliArgs(["--session", "abc123", "hello", "world"])).toEqual({
      promptArgs: ["hello", "world"],
      sessionId: "abc123",
      newSession: false,
      resumeLatest: false,
      toolsPreset: undefined,
      model: undefined,
      provider: undefined,
      configPath: undefined
    });

    expect(parseCliArgs(["--new", "hello"])).toEqual({
      promptArgs: ["hello"],
      sessionId: undefined,
      newSession: true,
      resumeLatest: false,
      toolsPreset: undefined,
      model: undefined,
      provider: undefined,
      configPath: undefined
    });

    expect(parseCliArgs(["--", "--new", "hello"])).toEqual({
      promptArgs: ["hello"],
      sessionId: undefined,
      newSession: true,
      resumeLatest: false,
      toolsPreset: undefined,
      model: undefined,
      provider: undefined,
      configPath: undefined
    });

    expect(parseCliArgs(["--resume", "hello"])).toEqual({
      promptArgs: ["hello"],
      sessionId: undefined,
      newSession: false,
      resumeLatest: true,
      toolsPreset: undefined,
      model: undefined,
      provider: undefined,
      configPath: undefined
    });
  });

  it("parses M5 config, model, and tool preset flags separately from prompt text", () => {
    expect(parseCliArgs([
      "--config",
      "/tmp/scorel.toml",
      "--provider",
      "amp",
      "--model",
      "gpt-5.4-mini",
      "--tools",
      "readonly",
      "inspect",
      "repo"
    ])).toEqual({
      promptArgs: ["inspect", "repo"],
      sessionId: undefined,
      newSession: false,
      resumeLatest: false,
      toolsPreset: "readonly",
      model: "gpt-5.4-mini",
      provider: "amp",
      configPath: "/tmp/scorel.toml"
    });
  });

  it("rejects a missing session id", () => {
    expect(() => parseCliArgs(["--session"])).toThrow("--session requires a session id");
  });

  it("rejects missing or invalid M5 flag values", () => {
    expect(() => parseCliArgs(["--config"])).toThrow("--config requires a path");
    expect(() => parseCliArgs(["--provider"])).toThrow("--provider requires a provider id");
    expect(() => parseCliArgs(["--model"])).toThrow("--model requires a model id");
    expect(() => parseCliArgs(["--tools"])).toThrow("--tools requires one of: none, readonly, coding, all");
    expect(() => parseCliArgs(["--tools", "danger"])).toThrow("--tools requires one of: none, readonly, coding, all");
  });


  it("parses slash commands separately from model prompts", () => {
    expect(parsePromptCommand("/history")).toEqual({ type: "history" });
    expect(parsePromptCommand("/rewind msg-1")).toEqual({ type: "rewind", targetMessageId: "msg-1" });
    expect(parsePromptCommand("/fork msg-1")).toEqual({ type: "fork", targetMessageId: "msg-1" });
    expect(parsePromptCommand("/exit")).toEqual({ type: "exit" });
    expect(parsePromptCommand("/hello world")).toEqual({ type: "extension", name: "hello", args: "world" });
    expect(parsePromptCommand("hello /history")).toEqual({ type: "prompt", prompt: "hello /history" });
  });

  it("rejects slash commands that require a message id", () => {
    expect(() => parsePromptCommand("/rewind")).toThrow("/rewind requires a message id");
    expect(() => parsePromptCommand("/fork")).toThrow("/fork requires a message id");
  });

  it("formats history with message ids and rewindable boundaries", () => {
    expect(
      formatHistory([
        {
          id: "msg-1",
          at: 1,
          rewindable: true,
          message: { role: "user", content: "first prompt", timestamp: 1 }
        },
        {
          id: "msg-2",
          at: 2,
          rewindable: false,
          message: assistantMessage("assistant response", 2)
        }
      ])
    ).toBe("msg-1 * user first prompt\nmsg-2 - assistant assistant response\n");
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

  it("uses bash instead of exposing a separate ls tool for coding preset", () => {
    expect(createCliTools("coding").map((tool) => tool.name)).toEqual(["read", "glob", "grep", "bash", "write", "edit"]);
  });

  it("can disable write tools with readonly preset", () => {
    expect(createCliTools("readonly").map((tool) => tool.name)).toEqual(["read", "glob", "grep"]);
    expect(createCliTools("none").map((tool) => tool.name)).toEqual([]);
  });

  it("runs registered extension slash commands and isolates command failures", async () => {
    await expect(runSlashCommand(
      { type: "extension", name: "hello", args: "world" },
      {
        hello: {
          description: "Hello",
          run: ({ args }) => `hello ${args}`
        }
      },
      {} as never
    )).resolves.toBe("hello world\n");

    await expect(runSlashCommand(
      { type: "extension", name: "missing", args: "" },
      {},
      {} as never
    )).resolves.toContain("Unknown slash command");

    await expect(runSlashCommand(
      { type: "extension", name: "bad", args: "" },
      {
        bad: {
          run: () => {
            throw new Error("command exploded");
          }
        }
      },
      {} as never
    )).resolves.toContain("command exploded");
  });

  it("enters interactive shell only for no-argument TTY usage", () => {
    const baseArgs = parseCliArgs(["--config", "/tmp/scorel.toml"]);
    expect(shouldStartInteractiveShell(baseArgs, true)).toBe(true);
    expect(shouldStartInteractiveShell(baseArgs, false)).toBe(false);
    expect(shouldStartInteractiveShell(parseCliArgs(["hello"]), true)).toBe(false);
    expect(shouldStartInteractiveShell(parseCliArgs(["/history"]), true)).toBe(false);
  });

  it("packages the CLI from built dist output", async () => {
    const packageJsonPath = fileURLToPath(new URL("../package.json", import.meta.url));
    const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));

    expect(packageJson.bin).toEqual({ scorel: "./dist/index.js" });
    expect(packageJson.files).toContain("dist");
    expect(packageJson.scripts.build).toBe("node ../../scripts/build-cli.mjs");
    expect(packageJson.scripts.prepack).toBe("pnpm run build");
  });
});
