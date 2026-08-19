/**
 * Scorel ACP (Agent Client Protocol) agent.
 *
 * Editors that implement ACP — Zed, JetBrains, Neovim, Emacs — spawn
 * `scorel acp` as a subprocess and drive it over JSON-RPC on stdin/stdout.
 * This module bridges ACP to an in-process ScorelHost + DaemonClient, the same
 * execution path the interactive `scorel chat` and headless `scorel run` use,
 * so every ACP turn runs against a real Scorel session with full tool access,
 * JSONL persistence, and replay.
 *
 * Protocol reference: https://agentclientprotocol.com
 * SDK: @agentclientprotocol/sdk
 */

import { Readable, Writable } from "node:stream";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import * as acp from "@agentclientprotocol/sdk";

import { DaemonClient } from "@scorel/client";
import {
  ScorelHost,
  createEmbeddedTransport,
  createRealRuntime,
  loadScorelConfig,
  loadScorelConfigProfile,
  scorelSessionsDir,
  type ScorelConfig,
} from "@scorel/daemon";
import {
  asClientId,
  asDeviceId,
  asSessionId,
  type ContentBlock as ScorelContentBlock,
  type PersistentEvent,
  type ScorelEvent,
  type SessionId,
  type Usage as ScorelUsage,
} from "@scorel/protocol";

export type AcpOptions = {
  /** Working directory hint when the client omits cwd on session/new. */
  cwd?: string;
  /** Scorel state dir (defaults to ~/.scorel). */
  stateDir?: string;
  /** Scorel sessions dir (defaults to <stateDir>/sessions). */
  sessionsDir?: string;
  /** Optional preloaded config (tests / hosted entry). */
  config?: ScorelConfig;
  /** JSON-RPC input stream (defaults to process.stdin). */
  input?: Readable;
  /** JSON-RPC output stream (defaults to process.stdout). */
  output?: Writable;
};

type AcpSession = {
  sessionId: SessionId;
  client: DaemonClient;
  /** Abort the in-flight prompt turn. */
  abort: AbortController;
  /** Last observed stop reason from turn_end, used to resolve session/prompt. */
  stopReason: acp.StopReason;
  /** Raw Scorel stop reason before ACP mapping (used to detect errors). */
  rawStopReason?: string;
  /** Last observed usage from turn_end, returned in PromptResponse. */
  usage?: acp.Usage | null;
  /** Error message captured from an error event during the current turn. */
  turnError?: string;
  /** True while a prompt turn is in flight; prevents concurrent prompts. */
  busy: boolean;
};

const AGENT_NAME = "scorel";

/**
 * Map a Scorel tool name to the closest ACP {@link acp.ToolKind}.
 *
 * ACP kinds: read | edit | delete | move | search | execute | think | fetch |
 * switch_mode | other. Scorel's 14 built-in tools map as follows:
 *
 *   Read                → read      (read a file)
 *   Glob, Grep          → search    (find files / search content)
 *   Write, Edit, snip   → edit      (modify workspace or session content)
 *   AppendDaily         → edit      (append to the daily journal file)
 *   Bash, BashStop      → execute   (run / stop shell commands)
 *   TodoWrite           → think     (task planning)
 *   Task, TaskStop      → think     (subagent delegation / control)
 *   Skill               → read      (load skill instructions from disk)
 *   SendChannelMessage  → other     (IM communication — no ACP kind fits)
 */
export const mapToolKind = (toolName: string): acp.ToolKind => {
  switch (toolName) {
    case "Read":
    case "Skill":
      return "read";
    case "Glob":
    case "Grep":
      return "search";
    case "Write":
    case "Edit":
    case "snip":
    case "AppendDaily":
      return "edit";
    case "Bash":
    case "BashStop":
      return "execute";
    case "TodoWrite":
    case "Task":
    case "TaskStop":
      return "think";
    case "SendChannelMessage":
      return "other";
    default:
      return "other";
  }
};

/**
 * Build a human-readable title for a tool call from the tool name and its
 * arguments, so editors can render a meaningful tool panel instead of a bare
 * tool name.
 */
export const toolTitle = (toolName: string, args: unknown): string => {
  const a = (args ?? {}) as Record<string, unknown>;
  const str = (v: unknown): string => (typeof v === "string" ? v : "");
  switch (toolName) {
    case "Read":
      return `Read ${str(a.file_path) || "file"}`;
    case "Write":
      return `Write ${str(a.file_path) || "file"}`;
    case "Edit":
      return `Edit ${str(a.file_path) || "file"}`;
    case "Glob":
      return `Find ${str(a.pattern) || "files"}`;
    case "Grep":
      return `Search for ${str(a.pattern) || "text"}`;
    case "Bash":
      return `Run: ${str(a.command) || "command"}`;
    case "BashStop":
      return `Stop process ${str(a.process_id) || ""}`.trim();
    case "TodoWrite":
      return "Update task list";
    case "Task":
      return str(a.description) || "Run subagent";
    case "TaskStop":
      return `Stop subagent ${str(a.task_id) || ""}`.trim();
    case "snip":
      return "Snip conversation";
    case "Skill":
      return `Load skill: ${str(a.name) || "unknown"}`;
    case "SendChannelMessage":
      return "Send channel message";
    case "AppendDaily":
      return "Append daily journal";
    default:
      return toolName;
  }
};

const mapStopReason = (reason: string | undefined): acp.StopReason => {
  if (reason === "cancelled") return "cancelled";
  if (reason === "max_tokens") return "max_tokens";
  // "error" and "unknown" are handled by the prompt handler, which throws a
  // JSON-RPC error instead of returning a misleading stopReason.
  return "end_turn";
};

/**
 * Convert a Scorel tool result (`{ content: ContentBlock[], details? }`) into
 * ACP {@link acp.ToolCallContent} entries for `tool_call_update.content`.
 *
 * Scorel tool results always contain `TextContentBlock` entries (see
 * `textResult` in coding-tools.ts). Non-text blocks are stringified as a
 * fallback so the editor never sees an empty panel.
 */
const toolResultToAcpContent = (result: unknown): acp.ToolCallContent[] => {
  if (!result || typeof result !== "object" || !Array.isArray((result as { content?: unknown }).content)) {
    return [];
  }
  const blocks = (result as { content: ScorelContentBlock[] }).content;
  return blocks.map((block): acp.ToolCallContent => {
    if (block.type === "text") {
      return { type: "content", content: { type: "text", text: block.text } };
    }
    // Non-text blocks (thinking, system_reminder, nested tool blocks) are
    // rare in tool results; surface them as text so the editor shows something.
    return { type: "content", content: { type: "text", text: JSON.stringify(block) } };
  });
};

/** Map Scorel usage (all fields optional) to ACP usage (totalTokens etc. required). */
const mapUsage = (usage: ScorelUsage | undefined): acp.Usage | null => {
  if (!usage) return null;
  const inputTokens = usage.inputTokens ?? 0;
  const outputTokens = usage.outputTokens ?? 0;
  const totalTokens = usage.totalTokens ?? inputTokens + outputTokens;
  return {
    totalTokens,
    inputTokens,
    outputTokens,
    ...(usage.cacheReadTokens != null ? { cachedReadTokens: usage.cacheReadTokens } : {}),
    ...(usage.cacheWriteTokens != null ? { cachedWriteTokens: usage.cacheWriteTokens } : {}),
  };
};

const defaultStateDir = (): string => join(homedir(), ".scorel");
const defaultSessionsDir = (stateDir: string): string => scorelSessionsDir(stateDir);

/**
 * Convert an ACP prompt (an array of content blocks) into Scorel content
 * blocks. Text blocks map directly; non-text blocks are represented as text
 * placeholders so the model at least sees them.
 */
const promptToContent = (prompt: acp.ContentBlock[]): ScorelContentBlock[] =>
  prompt.map((block): ScorelContentBlock => {
    if (block.type === "text") return { type: "text", text: block.text };
    if (block.type === "resource_link") {
      const uri = (block as { uri?: string }).uri ?? "";
      return { type: "text", text: `[Referenced resource: ${uri}]` };
    }
    return { type: "text", text: `[${block.type} attachment]` };
  });

export const runCliAcp = async (options: AcpOptions): Promise<number> => {
  const stateDir = options.stateDir ?? defaultStateDir();
  const sessionsDir = options.sessionsDir ?? defaultSessionsDir(stateDir);
  const fallbackCwd = options.cwd ?? process.cwd();

  // One shared Host per ACP process. It manages projects and sessions; each
  // ACP session gets its own DaemonClient over an embedded transport.
  const configScope = { scorelHomeDir: stateDir };
  const loadProjectConfig = (project: { workDir: string }): Promise<ScorelConfig> =>
    options.config ? Promise.resolve(options.config) : loadScorelConfig({ cwd: project.workDir, ...configScope });
  const loadProjectConfigProfile = (project: { workDir: string }) =>
    options.config
      ? Promise.resolve(options.config)
      : loadScorelConfigProfile({ cwd: project.workDir, ...configScope });

  const host = new ScorelHost({
    sessionsDir,
    projectsPath: join(stateDir, "projects.json"),
    deviceId: asDeviceId("device_local"),
    scorelHomeDir: stateDir,
    loadConfig: async ({ project }) => loadProjectConfig(project),
    loadConfigProfile: async ({ project }) => loadProjectConfigProfile(project),
    createRuntime: async ({ sessionId, project, selectedModel, purpose, backgroundBash }) =>
      createRealRuntime({
        cwd: project.workDir,
        config: await loadProjectConfig(project),
        sessionsDir,
        sessionId,
        modelSelection: selectedModel
          ? { modelId: selectedModel.modelId, role: selectedModel.role, reasoningEffort: selectedModel.reasoningEffort }
          : undefined,
        includeTools: purpose === "chat",
        backgroundBash,
      }),
  });

  const sessions = new Map<string, AcpSession>();
  let hostStarted = false;
  const ensureHost = async (): Promise<void> => {
    if (!hostStarted) {
      await host.start();
      hostStarted = true;
    }
  };

  const removeSession = (sessionId: string): void => {
    const session = sessions.get(sessionId);
    if (!session) return;
    sessions.delete(sessionId);
    session.abort.abort();
    session.client.disconnect();
  };

  /** Create a DaemonClient bound to a session and register it in the ACP session map. */
  const createAcpSession = (sessionId: SessionId): AcpSession => {
    const client = new DaemonClient(createEmbeddedTransport(host), {
      clientId: asClientId(`client_acp_${randomUUID()}`),
    });
    const session: AcpSession = {
      sessionId,
      client,
      abort: new AbortController(),
      stopReason: "end_turn",
      busy: false,
    };
    sessions.set(sessionId, session);
    return session;
  };

  /** Emit a tool_call notification from a Scorel tool_call content block. */
  const emitToolCall = async (
    client: acp.AgentContext,
    sessionId: string,
    block: Extract<ScorelContentBlock, { type: "tool_call" }>,
  ): Promise<void> => {
    await client.notify(acp.methods.client.session.update, {
      sessionId,
      update: {
        sessionUpdate: "tool_call",
        toolCallId: block.toolCallId,
        title: toolTitle(block.toolName, block.args),
        name: block.toolName,
        kind: mapToolKind(block.toolName),
        status: "in_progress",
        rawInput: block.args,
      },
    });
  };

  /** Emit a tool_call_update notification from a Scorel tool_result content block. */
  const emitToolResult = async (
    client: acp.AgentContext,
    sessionId: string,
    block: Extract<ScorelContentBlock, { type: "tool_result" }>,
  ): Promise<void> => {
    await client.notify(acp.methods.client.session.update, {
      sessionId,
      update: {
        sessionUpdate: "tool_call_update",
        toolCallId: block.toolCallId,
        status: block.isError ? "failed" : "completed",
        content: toolResultToAcpContent(block.result),
      },
    });
  };

  /**
   * Map a single live Scorel event into zero or more ACP session/update
   * notifications. Text and thinking deltas carry eventId which becomes the
   * ACP messageId, letting the editor group chunks into messages and detect
   * when a new message starts (e.g. after a tool call round-trip).
   */
  const emitUpdate = async (
    client: acp.AgentContext,
    sessionId: string,
    event: ScorelEvent,
  ): Promise<void> => {
    switch (event.type) {
      case "text_delta":
        await client.notify(acp.methods.client.session.update, {
          sessionId,
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: event.delta },
            messageId: event.eventId,
          },
        });
        return;
      case "thinking_delta":
        await client.notify(acp.methods.client.session.update, {
          sessionId,
          update: {
            sessionUpdate: "agent_thought_chunk",
            content: { type: "text", text: event.delta },
            messageId: event.eventId,
          },
        });
        return;
      case "assistant_message":
        // The complete message is persisted; text was already streamed via
        // text_delta, so only emit tool_call blocks that weren't streamed.
        for (const block of event.message.content) {
          if (block.type === "tool_call") await emitToolCall(client, sessionId, block);
        }
        return;
      case "tool_result":
        for (const block of event.message.content) {
          if (block.type === "tool_result") await emitToolResult(client, sessionId, block);
        }
        return;
      case "error":
        // Captured by the prompt handler; per ACP spec, operational errors
        // must be JSON-RPC errors, not agent_message_chunks.
        return;
      default:
        return;
    }
  };

  /**
   * Replay persisted history as session/update notifications (session/load).
   * Unlike live streaming, complete text/thinking blocks are emitted as
   * single chunks since there are no delta events in persisted history.
   */
  const replayHistory = async (
    client: acp.AgentContext,
    sessionId: string,
    events: PersistentEvent[],
  ): Promise<void> => {
    for (const event of events) {
      switch (event.type) {
        case "user_message":
          for (const block of event.message.content) {
            if (block.type === "text") {
              await client.notify(acp.methods.client.session.update, {
                sessionId,
                update: {
                  sessionUpdate: "user_message_chunk",
                  content: { type: "text", text: block.text },
                },
              });
            }
          }
          break;
        case "assistant_message":
          for (const block of event.message.content) {
            if (block.type === "text") {
              await client.notify(acp.methods.client.session.update, {
                sessionId,
                update: {
                  sessionUpdate: "agent_message_chunk",
                  content: { type: "text", text: block.text },
                  messageId: event.id,
                },
              });
            } else if (block.type === "thinking") {
              await client.notify(acp.methods.client.session.update, {
                sessionId,
                update: {
                  sessionUpdate: "agent_thought_chunk",
                  content: { type: "text", text: block.text },
                  messageId: event.id,
                },
              });
            } else if (block.type === "tool_call") {
              await emitToolCall(client, sessionId, block);
            }
          }
          break;
        case "tool_result":
          for (const block of event.message.content) {
            if (block.type === "tool_result") await emitToolResult(client, sessionId, block);
          }
          break;
        default:
          break;
      }
    }
  };

  const app = acp
    .agent({ name: AGENT_NAME })

    .onRequest(acp.methods.agent.initialize, (): acp.InitializeResponse => ({
      protocolVersion: acp.PROTOCOL_VERSION,
      agentCapabilities: {
        loadSession: true,
        sessionCapabilities: {
          list: {},
          resume: {},
          close: {},
        },
      },
    }))

    .onRequest(
      acp.methods.agent.session.new,
      async (ctx): Promise<acp.NewSessionResponse> => {
        await ensureHost();
        const cwd = ctx.params.cwd ?? fallbackCwd;
        const project = await host.registerProject(cwd);
        const sessionId = asSessionId(`ses_acp_${randomUUID()}`);
        const session = createAcpSession(sessionId);
        // Connect with the planned sessionId so the client is bound to it,
        // then create the session on the daemon. connect() does not require
        // the session to pre-exist — it only registers the connection.
        await session.client.connect(sessionId);
        await session.client.createSession({ sessionId, meta: { projectId: project.projectId } });
        return { sessionId };
      },
    )

    .onRequest(
      acp.methods.agent.session.load,
      async (ctx): Promise<acp.LoadSessionResponse> => {
        await ensureHost();
        const sessionId = asSessionId(ctx.params.sessionId);
        // Register the cwd so config resolves; registerProject is idempotent
        // and returns the existing project if the workDir is already known.
        const cwd = ctx.params.cwd ?? fallbackCwd;
        await host.registerProject(cwd);
        const session = createAcpSession(sessionId);
        await session.client.connect(sessionId);
        const loaded = await session.client.loadSession(sessionId);
        await replayHistory(ctx.client, sessionId, loaded.events);
        return {};
      },
    )

    .onRequest(
      acp.methods.agent.session.resume,
      async (ctx): Promise<acp.ResumeSessionResponse> => {
        await ensureHost();
        const sessionId = asSessionId(ctx.params.sessionId);
        const cwd = ctx.params.cwd ?? fallbackCwd;
        await host.registerProject(cwd);
        const session = createAcpSession(sessionId);
        await session.client.connect(sessionId);
        await session.client.loadSession(sessionId);
        return {};
      },
    )

    .onRequest(
      acp.methods.agent.session.list,
      async (ctx): Promise<acp.ListSessionsResponse> => {
        await ensureHost();
        const client = new DaemonClient(createEmbeddedTransport(host), {
          clientId: asClientId(`client_acp_list_${randomUUID()}`),
        });
        await client.connect();
        try {
          const projects = await client.listProjects();
          const projectById = new Map(projects.map((p) => [p.projectId, p]));
          const scorelSessions = await client.listSessions({ limit: 200 });
          // If the client requested a specific cwd, filter to sessions whose
          // project workDir matches. Otherwise return all sessions.
          const filterCwd = ctx.params.cwd;
          const filtered = filterCwd
            ? scorelSessions.filter((s) => projectById.get(s.projectId)?.workDir === filterCwd)
            : scorelSessions;
          const acpSessions: acp.SessionInfo[] = filtered.map((s) => {
            const project = projectById.get(s.projectId);
            const workDir = project?.workDir ?? fallbackCwd;
            return {
              sessionId: s.sessionId,
              cwd: workDir,
              ...(s.title ? { title: s.title } : {}),
              updatedAt: new Date(s.updatedAt).toISOString(),
            };
          });
          return { sessions: acpSessions };
        } finally {
          client.disconnect();
        }
      },
    )

    .onRequest(
      acp.methods.agent.session.prompt,
      async (ctx): Promise<acp.PromptResponse> => {
        const session = sessions.get(ctx.params.sessionId);
        if (!session) {
          throw new Error(`ACP session not found: ${ctx.params.sessionId}`);
        }
        if (session.busy) {
          throw new Error("A prompt turn is already in flight for this session");
        }
        // Reset per-turn state.
        session.busy = true;
        session.abort = new AbortController();
        session.stopReason = "end_turn";
        session.rawStopReason = undefined;
        session.usage = null;
        session.turnError = undefined;
        const content = promptToContent(ctx.params.prompt);

        // Track in-flight notifications so the prompt response is only sent
        // after every session/update has flushed onto the stream.
        const pending = new Set<Promise<void>>();
        const track = (p: Promise<void>): void => {
          pending.add(p);
          p.catch(() => undefined).finally(() => pending.delete(p));
        };

        const unsubscribe = session.client.subscribe((event) => {
          if (event.type === "turn_end") {
            session.rawStopReason = event.stopReason;
            session.stopReason = mapStopReason(event.stopReason);
            session.usage = mapUsage(event.usage);
          } else if (event.type === "error") {
            session.turnError = event.message;
          }
          track(emitUpdate(ctx.client, ctx.params.sessionId, event));
        });

        try {
          await session.client.sendMessage(content);
          // Drain any notifications still being written to the stream.
          while (pending.size > 0) await Promise.allSettled([...pending]);
          // If the turn ended with an error, return a JSON-RPC error per spec.
          if (session.turnError) {
            throw new Error(session.turnError);
          }
          if (session.rawStopReason === "error" || session.rawStopReason === "unknown") {
            throw new Error(`Agent turn ended with stop reason: ${session.rawStopReason}`);
          }
          return {
            stopReason: session.abort.signal.aborted ? "cancelled" : session.stopReason,
            ...(session.usage ? { usage: session.usage } : {}),
          };
        } catch (cause) {
          while (pending.size > 0) await Promise.allSettled([...pending]);
          if (session.abort.signal.aborted) {
            return { stopReason: "cancelled" };
          }
          throw cause;
        } finally {
          session.busy = false;
          unsubscribe();
        }
      },
    )

    .onRequest(acp.methods.agent.session.close, (ctx): acp.CloseSessionResponse => {
      removeSession(ctx.params.sessionId);
      return {};
    })

    .onNotification(acp.methods.agent.session.cancel, (ctx) => {
      const session = sessions.get(ctx.params.sessionId);
      if (!session) return;
      session.abort.abort();
      void session.client.cancel().catch(() => undefined);
    });

  // stdio: the SDK reads JSON-RPC from stdin and writes to stdout.
  const stdin = options.input ?? process.stdin;
  const stdout = options.output ?? process.stdout;
  const input = Writable.toWeb(stdout) as WritableStream<Uint8Array>;
  const output = Readable.toWeb(stdin) as ReadableStream<Uint8Array>;
  const stream = acp.ndJsonStream(input, output);

  await app.connect(stream);

  // Tear down everything when the editor dismisses the agent (stdin closes)
  // or the process is signaled to terminate. process.on("exit") can't await
  // so we do cleanup here and in the signal handlers instead.
  let shuttingDown = false;
  const signalHandlers: Array<[NodeJS.Signals, () => void]> = [];
  const shutdown = async (): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    for (const [sig, handler] of signalHandlers) process.off(sig, handler);
    for (const id of [...sessions.keys()]) removeSession(id);
    if (hostStarted) await host.shutdown().catch(() => undefined);
  };

  stdin.on("close", () => void shutdown());
  for (const sig of ["SIGTERM", "SIGINT"] as const) {
    const handler = (): void => void shutdown().finally(() => process.exit(0));
    process.on(sig, handler);
    signalHandlers.push([sig, handler]);
  }

  return 0;
};
