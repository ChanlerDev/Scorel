import { ChildProcessWithoutNullStreams, spawn } from "node:child_process";

import { SymphonyError } from "./errors.js";
import type { AgentRunnerEvent, CodexConfig } from "./types.js";

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
  timer: NodeJS.Timeout;
}

interface ProtocolMessage {
  id?: string | number;
  method?: string;
  params?: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: unknown;
  [key: string]: unknown;
}

export interface CodexSessionHandle {
  threadId: string;
  runTurn(prompt: string, title: string, onEvent: (event: AgentRunnerEvent) => void): Promise<{
    turnId: string;
  }>;
  stop(): Promise<void>;
}

export class CodexAppServerClient {
  constructor(private readonly config: CodexConfig) {}

  async startSession(workspacePath: string): Promise<CodexSessionHandle> {
    const child = spawn("bash", ["-lc", this.config.command], {
      cwd: workspacePath,
      stdio: ["pipe", "pipe", "pipe"]
    });

    const protocol = new ProtocolClient(child, this.config);

    await protocol.request(1, "initialize", {
      clientInfo: {
        name: "scorel-symphony",
        version: "0.1.0"
      },
      capabilities: {}
    });

    protocol.notify("initialized", {});

    const threadStart = await protocol.request(2, "thread/start", {
      approvalPolicy: this.config.approvalPolicy,
      sandbox: this.config.threadSandbox,
      cwd: workspacePath
    });

    const threadId = nestedString(threadStart, ["thread", "id"]);
    if (!threadId) {
      throw new SymphonyError("response_error", "Codex thread/start response is missing thread.id");
    }

    return {
      threadId,
      runTurn: async (prompt, title, onEvent) => {
        const requestId = protocol.nextRequestId();
        const turnStart = await protocol.request(requestId, "turn/start", {
          threadId,
          input: [{ type: "text", text: prompt }],
          cwd: workspacePath,
          title,
          approvalPolicy: this.config.approvalPolicy,
          sandboxPolicy: this.config.turnSandboxPolicy
        });

        const turnId = nestedString(turnStart, ["turn", "id"]);
        if (!turnId) {
          throw new SymphonyError("response_error", "Codex turn/start response is missing turn.id");
        }

        await protocol.awaitTurn(threadId, turnId, onEvent);
        return { turnId };
      },
      stop: async () => {
        await protocol.close();
      }
    };
  }
}

class ProtocolClient {
  private readonly pending = new Map<string, PendingRequest>();
  private readonly turnWaiters = new Set<(message: ProtocolMessage) => void>();
  private readonly lineBuffer = { stdout: "", stderr: "" };
  private closed = false;
  private requestIdCounter = 10;

  constructor(
    private readonly child: ChildProcessWithoutNullStreams,
    private readonly config: CodexConfig
  ) {
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    child.stdout.on("data", (chunk: string) => {
      this.lineBuffer.stdout += chunk;
      this.drainBuffer("stdout");
    });

    child.stderr.on("data", (chunk: string) => {
      this.lineBuffer.stderr += chunk;
      this.drainBuffer("stderr");
    });

    child.on("exit", (code) => {
      const error = new SymphonyError("port_exit", `Codex app-server exited with code ${code ?? "unknown"}`);
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(error);
      }
      this.pending.clear();
    });
  }

  nextRequestId(): number {
    this.requestIdCounter += 1;
    return this.requestIdCounter;
  }

  notify(method: string, params: Record<string, unknown>): void {
    this.send({ method, params });
  }

  async request(id: string | number, method: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
    const key = String(id);
    const response = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(key);
        reject(new SymphonyError("response_timeout", `${method} timed out after ${this.config.readTimeoutMs}ms`));
      }, this.config.readTimeoutMs);

      this.pending.set(key, { resolve, reject, timer });
    });

    this.send({ id, method, params });
    const result = await response;
    return asObject(result);
  }

  async awaitTurn(threadId: string, turnId: string, onEvent: (event: AgentRunnerEvent) => void): Promise<void> {
    const startedAt = Date.now();
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new SymphonyError("turn_timeout", `Turn ${turnId} exceeded ${this.config.turnTimeoutMs}ms`));
      }, this.config.turnTimeoutMs);

      const handleMessage = (message: ProtocolMessage) => {
        const event = toEvent(message);
        if (event) {
          onEvent(event);
        }

        const method = message.method ?? "";
        if (method.includes("requestUserInput") || containsInputRequired(message)) {
          cleanup();
          reject(new SymphonyError("turn_input_required", "Codex requested user input"));
          return;
        }

        if (message.id !== undefined && method.includes("approval")) {
          this.send({ id: message.id, result: { approved: true } });
          onEvent({
            event: "approval_auto_approved",
            timestamp: new Date(),
            message: "Auto-approved approval request"
          });
          return;
        }

        if (message.id !== undefined && method.includes("item/tool/call")) {
          this.send({ id: message.id, result: { success: false, error: "unsupported_tool_call" } });
          onEvent({
            event: "unsupported_tool_call",
            timestamp: new Date(),
            message: "Rejected unsupported dynamic tool call"
          });
          return;
        }

        if (method.includes("turn/completed")) {
          cleanup();
          resolve();
          return;
        }

        if (method.includes("turn/failed")) {
          cleanup();
          reject(new SymphonyError("turn_failed", summarizeMessage(message) ?? "Codex turn failed"));
          return;
        }

        if (method.includes("turn/cancelled")) {
          cleanup();
          reject(new SymphonyError("turn_cancelled", summarizeMessage(message) ?? "Codex turn cancelled"));
          return;
        }
      };

      const cleanup = () => {
        clearTimeout(timer);
        this.turnWaiters.delete(handleMessage);
      };

      this.turnWaiters.add(handleMessage);
      onEvent({
        event: "session_started",
        timestamp: new Date(startedAt),
        sessionId: `${threadId}-${turnId}`,
        threadId,
        turnId,
        codexAppServerPid: this.osPid()
      });
    });
  }

  async close(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.child.kill("SIGTERM");
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.child.kill("SIGKILL");
        resolve();
      }, 2_000);
      this.child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  private osPid(): string | null {
    return this.child.pid ? String(this.child.pid) : null;
  }

  private send(payload: Record<string, unknown>): void {
    if (this.closed) {
      throw new SymphonyError("port_exit", "Codex protocol client is closed");
    }

    this.child.stdin.write(`${JSON.stringify(payload)}\n`);
  }

  private drainBuffer(stream: "stdout" | "stderr"): void {
    let buffer = this.lineBuffer[stream];
    let index = buffer.indexOf("\n");

    while (index >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);

      if (line) {
        if (stream === "stdout") {
          this.handleStdoutLine(line);
        }
      }

      index = buffer.indexOf("\n");
    }

    this.lineBuffer[stream] = buffer;
  }

  private handleStdoutLine(line: string): void {
    let parsed: ProtocolMessage;
    try {
      parsed = JSON.parse(line) as ProtocolMessage;
    } catch {
      const malformed: ProtocolMessage = {
        method: "malformed",
        params: {
          line
        }
      };
      for (const waiter of this.turnWaiters) {
        waiter(malformed);
      }
      return;
    }

    if (parsed.id !== undefined && this.pending.has(String(parsed.id)) && ("result" in parsed || "error" in parsed)) {
      const pending = this.pending.get(String(parsed.id));
      if (!pending) {
        return;
      }

      clearTimeout(pending.timer);
      this.pending.delete(String(parsed.id));

      if (parsed.error) {
        pending.reject(new SymphonyError("response_error", summarizeMessage(parsed) ?? "Codex returned an error response"));
      } else {
        pending.resolve(parsed.result ?? {});
      }
      return;
    }

    for (const waiter of this.turnWaiters) {
      waiter(parsed);
    }
  }
}

function toEvent(message: ProtocolMessage): AgentRunnerEvent | null {
  const timestamp = new Date();
  const method = message.method ?? "notification";
  const usage = extractUsage(message);
  const rateLimits = extractRateLimits(message);

  return compactObject({
    event: method,
    timestamp,
    usage,
    rateLimits,
    message: summarizeMessage(message),
    raw: message
  });
}

function extractUsage(value: unknown): AgentRunnerEvent["usage"] | undefined {
  const total = findNumericField(value, ["total_tokens", "totalTokens", "total_token_count"]);
  const input = findNumericField(value, ["input_tokens", "inputTokens", "input_token_count"]);
  const output = findNumericField(value, ["output_tokens", "outputTokens", "output_token_count"]);

  if (input === undefined && output === undefined && total === undefined) {
    return undefined;
  }

  return compactObject({
    inputTokens: input,
    outputTokens: output,
    totalTokens: total
  });
}

function extractRateLimits(value: unknown): Record<string, unknown> | null {
  return (
    findObjectField(value, ["rate_limits", "rateLimits", "rate_limit", "rateLimit"]) ?? null
  );
}

function containsInputRequired(value: unknown): boolean {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  if (record.requiresInput === true || record.inputRequired === true) {
    return true;
  }

  return Object.values(record).some((child) => containsInputRequired(child));
}

function summarizeMessage(value: unknown): string | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  for (const key of ["message", "text", "summary"]) {
    const candidate = record[key];
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }

  return Object.values(record)
    .map((child) => summarizeMessage(child))
    .find((candidate): candidate is string => Boolean(candidate)) ?? null;
}

function findNumericField(value: unknown, keys: string[]): number | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  for (const key of keys) {
    const candidate = record[key];
    if (typeof candidate === "number") {
      return candidate;
    }
  }

  for (const child of Object.values(record)) {
    const nested = findNumericField(child, keys);
    if (nested !== undefined) {
      return nested;
    }
  }

  return undefined;
}

function findObjectField(value: unknown, keys: string[]): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  for (const key of keys) {
    const candidate = record[key];
    if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
      return candidate as Record<string, unknown>;
    }
  }

  for (const child of Object.values(record)) {
    const nested = findObjectField(child, keys);
    if (nested) {
      return nested;
    }
  }

  return undefined;
}

function nestedString(source: Record<string, unknown>, path: string[]): string | null {
  let current: unknown = source;
  for (const segment of path) {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return null;
    }
    current = (current as Record<string, unknown>)[segment];
  }

  return typeof current === "string" ? current : null;
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function compactObject<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, candidate]) => candidate !== undefined)
  ) as T;
}
