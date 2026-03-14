import os from "node:os";
import path from "node:path";

import { SymphonyError } from "./errors.js";
import type { ServiceConfig, WorkflowDefinition } from "./types.js";

const DEFAULT_ACTIVE_STATES = ["Todo", "In Progress"];
const DEFAULT_TERMINAL_STATES = ["Closed", "Cancelled", "Canceled", "Duplicate", "Done"];

export function resolveConfig(
  workflow: WorkflowDefinition,
  env: NodeJS.ProcessEnv = process.env
): ServiceConfig {
  const config = workflow.config;
  const tracker = objectValue(config.tracker);
  const polling = objectValue(config.polling);
  const workspace = objectValue(config.workspace);
  const hooks = objectValue(config.hooks);
  const agent = objectValue(config.agent);
  const codex = objectValue(config.codex);
  const server = objectValue(config.server);

  return {
    tracker: {
      kind: "linear",
      endpoint: stringValue(tracker.endpoint) ?? "https://api.linear.app/graphql",
      apiKey: resolveSecret(stringValue(tracker.api_key), env.LINEAR_API_KEY, env),
      projectSlug: stringValue(tracker.project_slug) ?? null,
      activeStates: stringListValue(tracker.active_states) ?? DEFAULT_ACTIVE_STATES,
      terminalStates: stringListValue(tracker.terminal_states) ?? DEFAULT_TERMINAL_STATES
    },
    polling: {
      intervalMs: positiveIntValue(polling.interval_ms, 30_000)
    },
    workspace: {
      root: resolveWorkspaceRoot(stringValue(workspace.root), env)
    },
    hooks: {
      afterCreate: stringValue(hooks.after_create) ?? null,
      beforeRun: stringValue(hooks.before_run) ?? null,
      afterRun: stringValue(hooks.after_run) ?? null,
      beforeRemove: stringValue(hooks.before_remove) ?? null,
      timeoutMs: positiveIntValue(hooks.timeout_ms, 60_000)
    },
    agent: {
      maxConcurrentAgents: positiveIntValue(agent.max_concurrent_agents, 10),
      maxRetryBackoffMs: positiveIntValue(agent.max_retry_backoff_ms, 300_000),
      maxTurns: positiveIntValue(agent.max_turns, 20),
      maxConcurrentAgentsByState: normalizeStateCapMap(agent.max_concurrent_agents_by_state)
    },
    codex: compactObject({
      command: nonEmptyStringValue(codex.command) ?? "codex app-server",
      approvalPolicy: nonEmptyStringValue(codex.approval_policy) ?? "never",
      threadSandbox: nonEmptyStringValue(codex.thread_sandbox) ?? "danger-full-access",
      turnSandboxPolicy: objectOrUndefined(codex.turn_sandbox_policy),
      turnTimeoutMs: positiveIntValue(codex.turn_timeout_ms, 3_600_000),
      readTimeoutMs: positiveIntValue(codex.read_timeout_ms, 5_000),
      stallTimeoutMs: intValue(codex.stall_timeout_ms, 300_000)
    }),
    server: compactObject({
      port: nonNegativeIntValue(server.port)
    })
  };
}

export function validateDispatchConfig(config: ServiceConfig): void {
  if (config.tracker.kind !== "linear") {
    throw new SymphonyError("unsupported_tracker_kind", `Unsupported tracker kind: ${config.tracker.kind}`);
  }

  if (!config.tracker.apiKey) {
    throw new SymphonyError("missing_tracker_api_key", "Tracker API key is required");
  }

  if (!config.tracker.projectSlug) {
    throw new SymphonyError("missing_tracker_project_slug", "Tracker project slug is required");
  }

  if (!config.codex.command.trim()) {
    throw new SymphonyError("missing_codex_command", "codex.command must be non-empty");
  }
}

function resolveSecret(value: string | null, fallback: string | undefined, env: NodeJS.ProcessEnv): string | null {
  if (!value) {
    return fallback?.trim() || null;
  }

  if (!value.startsWith("$")) {
    return value;
  }

  const resolved = env[value.slice(1)]?.trim() ?? "";
  return resolved || null;
}

function resolveWorkspaceRoot(input: string | null, env: NodeJS.ProcessEnv): string {
  const defaultRoot = path.join(os.tmpdir(), "symphony_workspaces");

  if (!input) {
    return defaultRoot;
  }

  const maybeEnv = input.startsWith("$") ? env[input.slice(1)] ?? "" : input;
  if (!maybeEnv) {
    return defaultRoot;
  }

  if (maybeEnv.startsWith("~")) {
    return path.resolve(path.join(os.homedir(), maybeEnv.slice(1)));
  }

  if (maybeEnv.includes(path.sep) || maybeEnv.includes("/") || maybeEnv.includes("\\")) {
    return path.resolve(maybeEnv);
  }

  return maybeEnv;
}

function normalizeStateCapMap(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const result: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value)) {
    const parsed = intValue(raw, -1);
    if (parsed > 0) {
      result[key.toLowerCase()] = parsed;
    }
  }
  return result;
}

function objectValue(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function objectOrUndefined(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  return value as Record<string, unknown>;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function nonEmptyStringValue(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function stringListValue(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  return value.map((item) => String(item));
}

function intValue(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isInteger(value)) {
    return value;
  }

  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) {
    return Number.parseInt(value, 10);
  }

  return fallback;
}

function positiveIntValue(value: unknown, fallback: number): number {
  const parsed = intValue(value, fallback);
  return parsed > 0 ? parsed : fallback;
}

function nonNegativeIntValue(value: unknown): number | undefined {
  const parsed = intValue(value, -1);
  return parsed >= 0 ? parsed : undefined;
}

function compactObject<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, candidate]) => candidate !== undefined)
  ) as T;
}
