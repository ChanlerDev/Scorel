import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import type { Interface as ReadlineInterface } from "node:readline";
import path from "node:path";
import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import type { ToolResult } from "../../shared/types.js";
import {
  RUNNER_HEARTBEAT_INTERVAL_MS,
  RUNNER_ABORT_GRACE_MS,
  DEFAULT_TOOL_TIMEOUT_MS,
  MAX_TOOL_TIMEOUT_MS,
  NANOID_LENGTH,
} from "../../shared/constants.js";
import type { RunnerCommand, RunnerEvent, ToolRunner } from "./runner-protocol.js";

function generateId(): string {
  return crypto.randomBytes(16).toString("base64url").slice(0, NANOID_LENGTH);
}

type PendingExecution = {
  toolCallId: string;
  resolve: (result: ToolResult) => void;
  reject: (error: Error) => void;
  timeoutTimer: ReturnType<typeof setTimeout>;
  graceTimer?: ReturnType<typeof setTimeout>;
  onUpdate?: (partial: string) => void;
  aborted: boolean;
};

export class RunnerManager extends EventEmitter implements ToolRunner {
  private readonly workspaceRoot: string;
  private readonly runnerPath: string;
  private child: ChildProcess | null = null;
  private rl: ReadlineInterface | null = null;
  private pending = new Map<string, PendingExecution>();
  private lastHeartbeat = 0;
  private heartbeatCheckTimer: ReturnType<typeof setInterval> | null = null;
  private _isRunning = false;

  constructor(opts: { workspaceRoot: string; runnerPath?: string }) {
    super();
    this.workspaceRoot = opts.workspaceRoot;
    this.runnerPath = opts.runnerPath ?? path.join(
      process.cwd(), "dist", "runner", "index.js",
    );
  }

  get isRunning(): boolean {
    return this._isRunning;
  }

  async start(): Promise<void> {
    if (this._isRunning) return;

    this.child = spawn(process.execPath, [this.runnerPath, this.workspaceRoot], {
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1",
      },
    });

    this._isRunning = true;
    this.lastHeartbeat = Date.now();

    // Read stdout JSONL
    this.rl = createInterface({ input: this.child.stdout!, terminal: false });
    this.rl.on("line", (line) => this.handleLine(line));

    // stderr → debug
    this.child.stderr?.on("data", (chunk: Buffer) => {
      this.emit("log", chunk.toString());
    });

    // Crash detection
    this.child.on("exit", (code, signal) => {
      this._isRunning = false;
      this.emit("crash", { code, signal });
      this.rejectAllPending(
        new Error(`Runner process exited unexpectedly (code=${code}, signal=${signal})`),
      );
    });

    this.child.on("error", (err) => {
      this._isRunning = false;
      this.emit("crash", { error: err.message });
      this.rejectAllPending(err);
    });

    // Heartbeat monitoring
    this.heartbeatCheckTimer = setInterval(() => {
      const elapsed = Date.now() - this.lastHeartbeat;
      if (elapsed > RUNNER_HEARTBEAT_INTERVAL_MS * 3) {
        this.emit("crash", { reason: "heartbeat_timeout" });
        this.killAndRestart();
      }
    }, RUNNER_HEARTBEAT_INTERVAL_MS);

    // Wait for initial heartbeat
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Runner failed to start (no initial heartbeat)"));
      }, 5_000);

      const checkHeartbeat = (line: string) => {
        try {
          const event = JSON.parse(line) as RunnerEvent;
          if (event.type === "heartbeat") {
            clearTimeout(timeout);
            resolve();
          }
        } catch { /* ignore parse errors during startup */ }
      };

      // Temporarily listen on the readline for the first heartbeat
      // The handleLine method will also process it
      this.rl!.once("line", checkHeartbeat);
    });
  }

  async stop(): Promise<void> {
    if (this.heartbeatCheckTimer) {
      clearInterval(this.heartbeatCheckTimer);
      this.heartbeatCheckTimer = null;
    }

    if (!this.child || !this._isRunning) return;

    // Remove exit listener to avoid crash event on intentional stop
    this.child.removeAllListeners("exit");
    this._isRunning = false;

    this.child.stdin?.end();
    this.child.kill("SIGTERM");

    await new Promise<void>((resolve) => {
      const forceKill = setTimeout(() => {
        if (this.child && !this.child.killed) {
          this.child.kill("SIGKILL");
        }
        resolve();
      }, RUNNER_ABORT_GRACE_MS);

      this.child!.on("exit", () => {
        clearTimeout(forceKill);
        resolve();
      });
    });

    this.rl?.close();
    this.rl = null;
    this.child = null;
    this.rejectAllPending(new Error("Runner stopped"));
  }

  async execute(
    toolCallId: string,
    toolName: string,
    args: Record<string, unknown>,
    opts?: { timeoutMs?: number; onUpdate?: (partial: string) => void },
  ): Promise<ToolResult> {
    if (!this._isRunning || !this.child) {
      throw new Error("Runner is not running");
    }

    const timeoutMs = Math.min(
      opts?.timeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS,
      MAX_TOOL_TIMEOUT_MS,
    );

    return new Promise<ToolResult>((resolve, reject) => {
      const requestId = generateId();

      const timeoutTimer = setTimeout(() => {
        this.handleTimeout(toolCallId);
      }, timeoutMs);

      this.pending.set(toolCallId, {
        toolCallId,
        resolve,
        reject,
        timeoutTimer,
        onUpdate: opts?.onUpdate,
        aborted: false,
      });

      const cmd: RunnerCommand = {
        type: "tool.exec",
        requestId,
        toolCallId,
        tool: toolName,
        args,
      };
      this.sendCommand(cmd);
    });
  }

  async abort(toolCallId: string): Promise<void> {
    const pending = this.pending.get(toolCallId);
    if (!pending) return;

    pending.aborted = true;
    this.sendCommand({ type: "abort", toolCallId });
  }

  private sendCommand(cmd: RunnerCommand): void {
    if (!this.child?.stdin?.writable) return;
    this.child.stdin.write(JSON.stringify(cmd) + "\n");
  }

  private handleLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;

    let event: RunnerEvent;
    try {
      event = JSON.parse(trimmed) as RunnerEvent;
    } catch {
      return;
    }

    switch (event.type) {
      case "heartbeat":
        this.lastHeartbeat = Date.now();
        break;

      case "tool_execution_start":
        // Informational — could emit to UI
        break;

      case "tool_execution_update": {
        const pending = this.pending.get(event.toolCallId);
        if (pending?.onUpdate) {
          pending.onUpdate(event.partial);
        }
        break;
      }

      case "tool_execution_end": {
        const pending = this.pending.get(event.toolCallId);
        if (pending) {
          clearTimeout(pending.timeoutTimer);
          if (pending.graceTimer) clearTimeout(pending.graceTimer);
          this.pending.delete(event.toolCallId);
          pending.resolve(event.result);
        }
        break;
      }
    }
  }

  private handleTimeout(toolCallId: string): void {
    const pending = this.pending.get(toolCallId);
    if (!pending) return;

    // Send abort
    this.sendCommand({ type: "abort", toolCallId });

    // Grace period
    pending.graceTimer = setTimeout(() => {
      const stillPending = this.pending.get(toolCallId);
      if (stillPending) {
        this.pending.delete(toolCallId);
        stillPending.resolve({
          toolCallId,
          isError: true,
          content: "Tool execution timed out",
        });
        // Kill and restart runner
        this.killAndRestart();
      }
    }, RUNNER_ABORT_GRACE_MS);
  }

  private killAndRestart(): void {
    this.rejectAllPending(new Error("Runner killed due to timeout/crash"));

    if (this.child && !this.child.killed) {
      this.child.removeAllListeners("exit");
      this.child.kill("SIGKILL");
    }
    this._isRunning = false;
    this.rl?.close();
    this.rl = null;
    this.child = null;

    // Auto-restart
    this.start().catch((err) => {
      this.emit("crash", { reason: "restart_failed", error: String(err) });
    });
  }

  private rejectAllPending(error: Error): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timeoutTimer);
      if (pending.graceTimer) clearTimeout(pending.graceTimer);
      pending.resolve({
        toolCallId: id,
        isError: true,
        content: `Runner error: ${error.message}`,
      });
    }
    this.pending.clear();
  }
}
