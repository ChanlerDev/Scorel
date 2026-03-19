import { spawn } from "node:child_process";
import type { ToolResult, ToolHandler } from "../types.js";

const BASH_MAX_OUTPUT = 32_000;

function truncateBashOutput(output: string): { content: string; truncated: boolean } {
  if (output.length <= BASH_MAX_OUTPUT) {
    return { content: output, truncated: false };
  }
  const headSize = 8_000;
  const tailSize = 8_000;
  const omitted = output.length - headSize - tailSize;
  const content =
    output.slice(0, headSize) +
    `\n...[truncated ${omitted} chars]...\n` +
    output.slice(-tailSize);
  return { content, truncated: true };
}

export const bashTool: ToolHandler = async (args, workspaceRoot, signal) => {
  const command = args.command as string | undefined;
  if (!command) {
    return {
      toolCallId: "",
      isError: true,
      content: "Missing required argument: command",
    };
  }

  const timeoutMs = typeof args.timeout_ms === "number"
    ? Math.min(args.timeout_ms, 300_000)
    : 30_000;

  return new Promise<ToolResult>((resolve) => {
    const child = spawn(command, {
      shell: true,
      cwd: workspaceRoot,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, HOME: process.env.HOME },
    });

    let output = "";
    let killed = false;

    const timeout = setTimeout(() => {
      killed = true;
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!child.killed) child.kill("SIGKILL");
      }, 2_000);
    }, timeoutMs);

    const onAbort = () => {
      killed = true;
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!child.killed) child.kill("SIGKILL");
      }, 2_000);
    };
    signal.addEventListener("abort", onAbort, { once: true });

    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });

    child.on("error", (err) => {
      clearTimeout(timeout);
      signal.removeEventListener("abort", onAbort);
      resolve({
        toolCallId: "",
        isError: true,
        content: `Failed to execute command: ${err.message}`,
      });
    });

    child.on("close", (code) => {
      clearTimeout(timeout);
      signal.removeEventListener("abort", onAbort);

      if (killed && signal.aborted) {
        resolve({
          toolCallId: "",
          isError: true,
          content: "Command aborted by user",
          details: { exitCode: code ?? 137 },
        });
        return;
      }

      if (killed) {
        resolve({
          toolCallId: "",
          isError: true,
          content: `Command timed out after ${timeoutMs}ms`,
          details: { exitCode: code ?? 137 },
        });
        return;
      }

      const { content, truncated } = truncateBashOutput(output);
      resolve({
        toolCallId: "",
        isError: false,
        content,
        details: {
          rawOutput: truncated ? output : undefined,
          exitCode: code ?? 0,
          truncated,
        },
      });
    });
  });
};
