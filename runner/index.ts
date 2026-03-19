import { createInterface } from "node:readline";
import type { RunnerCommand, RunnerEvent, ToolHandler } from "./types.js";
import { bashTool } from "./tools/bash.js";
import { readFileTool } from "./tools/read-file.js";
import { writeFileTool } from "./tools/write-file.js";
import { editFileTool } from "./tools/edit-file.js";

const HEARTBEAT_INTERVAL_MS = 2_000;

const workspaceRoot = process.argv[2];
if (!workspaceRoot) {
  process.stderr.write("Usage: runner <workspaceRoot>\n");
  process.exit(1);
}

const toolHandlers = new Map<string, ToolHandler>([
  ["bash", bashTool],
  ["read_file", readFileTool],
  ["write_file", writeFileTool],
  ["edit_file", editFileTool],
]);

// Track in-flight executions for abort support
const inFlight = new Map<string, AbortController>();

function send(event: RunnerEvent): void {
  process.stdout.write(JSON.stringify(event) + "\n");
}

function log(msg: string): void {
  process.stderr.write(`[runner] ${msg}\n`);
}

// Heartbeat
const heartbeatTimer = setInterval(() => {
  send({ type: "heartbeat" });
}, HEARTBEAT_INTERVAL_MS);
heartbeatTimer.unref();

async function handleExec(cmd: Extract<RunnerCommand, { type: "tool.exec" }>): Promise<void> {
  const { toolCallId, tool, args } = cmd;
  const handler = toolHandlers.get(tool);

  if (!handler) {
    send({
      type: "tool_execution_end",
      toolCallId,
      result: {
        toolCallId,
        isError: true,
        content: `Unknown tool: ${tool}`,
      },
    });
    return;
  }

  const ac = new AbortController();
  inFlight.set(toolCallId, ac);

  send({ type: "tool_execution_start", toolCallId });

  try {
    const result = await handler(args, workspaceRoot, ac.signal);
    result.toolCallId = toolCallId;
    send({ type: "tool_execution_end", toolCallId, result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    send({
      type: "tool_execution_end",
      toolCallId,
      result: { toolCallId, isError: true, content: `Tool execution error: ${msg}` },
    });
  } finally {
    inFlight.delete(toolCallId);
  }
}

function handleAbort(cmd: Extract<RunnerCommand, { type: "abort" }>): void {
  const ac = inFlight.get(cmd.toolCallId);
  if (ac) {
    ac.abort();
    log(`Aborted tool call: ${cmd.toolCallId}`);
  }
}

function handlePing(): void {
  send({ type: "heartbeat" });
}

// Read JSONL from stdin
const rl = createInterface({ input: process.stdin, terminal: false });

rl.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;

  let cmd: RunnerCommand;
  try {
    cmd = JSON.parse(trimmed) as RunnerCommand;
  } catch {
    log(`Invalid JSON: ${trimmed}`);
    return;
  }

  switch (cmd.type) {
    case "tool.exec":
      handleExec(cmd).catch((err) => {
        log(`Unhandled error in exec: ${err}`);
      });
      break;
    case "abort":
      handleAbort(cmd);
      break;
    case "ping":
      handlePing();
      break;
    default:
      log(`Unknown command type: ${(cmd as { type: string }).type}`);
  }
});

rl.on("close", () => {
  clearInterval(heartbeatTimer);
  process.exit(0);
});

// Send initial heartbeat to signal readiness
send({ type: "heartbeat" });
