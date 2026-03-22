import type Database from "better-sqlite3";
import type {
  ManualCompactResult,
  McpCallToolResult,
  PermissionConfig,
  ProviderConfig,
  ScorelMessage,
  UserMessage,
  AssistantMessage,
  SkillMeta,
  ToolResult,
  ToolResultMessage,
  ToolCall,
  ToolCallPart,
  SessionMeta,
  SubagentStatus,
} from "../../shared/types.js";
import type { AssistantMessageEvent } from "../../shared/events.js";
import { MICRO_COMPACT_KEEP_RECENT } from "../../shared/constants.js";
import type { ProviderAdapter } from "../provider/types.js";
import { SessionManager } from "./session-manager.js";
import { EventBus } from "./event-bus.js";
import type { ToolRunner } from "../runner/runner-protocol.js";
import {
  getToolTimeout,
  getToolEntry,
  makeDeniedResult,
  makePolicyDeniedResult,
  getToolDefinitions,
  resolveToolApproval,
} from "./tool-dispatch.js";
import {
  applyBoundaryResume,
  applyMicroCompact,
  executeManualCompact,
} from "./compact.js";
import { generateId } from "./id.js";
import { getCompaction } from "../storage/compactions.js";
import { formatSkillList, loadSkill } from "../skills/skill-loader.js";
import { deleteTodo, listTodos, updateTodo, createTodo } from "../storage/todos.js";
import { getAutoCompactConfig, runAutoCompact, shouldAutoCompact } from "./auto-compact.js";
import {
  canSpawnSubagent,
  getSubagentMaxTurns,
  makeSubagentErrorResult,
  summarizeChildMessages,
} from "./subagent.js";
import type { McpManager } from "../mcp/manager.js";

export type ProviderEntry = {
  config: ProviderConfig;
  adapter: ProviderAdapter;
  getApiKey: () => Promise<string | null>;
};

type ApprovalRequest = {
  sessionId: string;
  toolCall: ToolCall;
  resolve: (decision: "approved" | "denied") => void;
};

export class Orchestrator {
  private readonly db: Database.Database;
  private readonly sessionManager: SessionManager;
  private readonly eventBus: EventBus;
  private readonly providers: Map<string, ProviderEntry>;
  private readonly toolRunner: ToolRunner | null;
  private readonly createToolRunner: ((workspaceRoot: string) => Promise<ToolRunner>) | null;
  private readonly skills: SkillMeta[];
  private readonly compactTranscriptDir?: string;
  private readonly getGlobalPermissionConfig: () => PermissionConfig | null;
  private readonly mcpManager: Pick<McpManager, "callTool"> | null;
  private readonly workspaceToolRunners = new Map<string, ToolRunner>();
  private readonly activeChildSessions = new Map<string, string>();
  private readonly pendingApprovals = new Map<string, ApprovalRequest>();

  constructor(opts: {
    db: Database.Database;
    sessionManager: SessionManager;
    eventBus: EventBus;
    providers: Map<string, ProviderEntry>;
    toolRunner?: ToolRunner;
    createToolRunner?: (workspaceRoot: string) => Promise<ToolRunner>;
    skills?: SkillMeta[];
    compactTranscriptDir?: string;
    getGlobalPermissionConfig?: () => PermissionConfig | null;
    mcpManager?: Pick<McpManager, "callTool">;
  }) {
    this.db = opts.db;
    this.sessionManager = opts.sessionManager;
    this.eventBus = opts.eventBus;
    this.providers = opts.providers;
    this.toolRunner = opts.toolRunner ?? null;
    this.createToolRunner = opts.createToolRunner ?? null;
    this.skills = opts.skills ?? [];
    this.compactTranscriptDir = opts.compactTranscriptDir;
    this.getGlobalPermissionConfig = opts.getGlobalPermissionConfig ?? (() => null);
    this.mcpManager = opts.mcpManager ?? null;
  }

  async send(sessionId: string, text: string): Promise<void> {
    await this.runSessionPrompt(sessionId, text);
  }

  private async runSessionPrompt(
    sessionId: string,
    text: string,
    opts?: { maxTurns?: number },
  ): Promise<{ status: Exclude<SubagentStatus, "error">; turnsUsed: number }> {
    const state = this.sessionManager.getState(sessionId);
    if (state !== "idle") {
      throw new Error(`Session ${sessionId} is in state "${state}", expected "idle"`);
    }

    const session = this.sessionManager.getMeta(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    const { activeProviderId: providerId, activeModelId: modelId } = session;
    if (!providerId || !modelId) {
      throw new Error("No provider/model configured for session");
    }

    const provider = this.providers.get(providerId);
    if (!provider) throw new Error(`Provider "${providerId}" not found`);

    const apiKey = await provider.getApiKey();
    if (!apiKey) throw new Error(`No API key for provider "${providerId}"`);

    // Persist user message
    const userMessage: UserMessage = {
      role: "user",
      id: generateId(),
      content: text,
      ts: Date.now(),
    };
    this.sessionManager.appendMessage(sessionId, userMessage);
    this.eventBus.emitAppEvent({
      type: "user.prompt",
      sessionId,
      ts: userMessage.ts,
      message: userMessage,
    });

    // Enter the model loop (stream → tool calls → stream → ... → final text)
    try {
      return await this.modelLoop(sessionId, provider, apiKey, opts);
    } catch (err) {
      this.sessionManager.clearAbortController(sessionId);
      this.sessionManager.setState(sessionId, "idle");
      throw err;
    }
  }

  private async modelLoop(
    sessionId: string,
    provider: ProviderEntry,
    apiKey: string,
    opts?: { maxTurns?: number },
  ): Promise<{ status: Exclude<SubagentStatus, "error">; turnsUsed: number }> {
    let turnsUsed = 0;

    while (true) {
      turnsUsed += 1;
      const session = this.sessionManager.getMeta(sessionId)!;
      const systemPrompt = this.assembleSystemPrompt(session);
      const messages = this.getContextMessages(sessionId, session);
      const toolDefinitions = this.getAvailableToolDefinitions();

      // Stream phase
      this.sessionManager.setState(sessionId, "streaming");
      const abortController = new AbortController();
      this.sessionManager.setAbortController(sessionId, abortController);

      this.eventBus.emitAppEvent({
        type: "llm.request",
        sessionId,
        ts: Date.now(),
        providerId: provider.config.id,
        modelId: session.activeModelId!,
        api: provider.config.api,
      });

      let assistantMessage: AssistantMessage;
      try {
        assistantMessage = await provider.adapter.stream(
          provider.config,
          apiKey,
          {
            systemPrompt,
            messages,
            providerId: provider.config.id,
            modelId: session.activeModelId!,
            tools: toolDefinitions,
            signal: abortController.signal,
          },
          (event: AssistantMessageEvent) => {
            this.eventBus.emitStreamEvent(sessionId, event);
            this.eventBus.emitAppEvent({
              type: "llm.stream",
              sessionId,
              ts: Date.now(),
              event,
            });
          },
        );
      } finally {
        this.sessionManager.clearAbortController(sessionId);
      }

      // Handle aborted
      if (assistantMessage.stopReason === "aborted") {
        const hasVisibleOutput = assistantMessage.content.some(
          (p) => p.type === "text" && p.text.length > 0,
        );
        if (hasVisibleOutput) {
          this.sessionManager.appendMessage(sessionId, assistantMessage);
        }
        this.sessionManager.setState(sessionId, "idle");
        return { status: "aborted", turnsUsed };
      }

      // Persist assistant message
      this.sessionManager.appendMessage(sessionId, assistantMessage);
      this.eventBus.emitAppEvent({
        type: "llm.done",
        sessionId,
        ts: Date.now(),
        message: assistantMessage,
      });

      // If no tool calls, we're done
      if (assistantMessage.stopReason !== "toolUse") {
        await this.maybeAutoCompact(sessionId, session, provider, apiKey, assistantMessage);
        this.sessionManager.setState(sessionId, "idle");
        return { status: "completed", turnsUsed };
      }

      // Extract tool calls
      const toolCalls = this.extractToolCalls(assistantMessage);
      if (toolCalls.length === 0) {
        this.sessionManager.setState(sessionId, "idle");
        return { status: "completed", turnsUsed };
      }

      const hasLocalCalls = toolCalls.some((toolCall) => {
        const entry = getToolEntry(toolCall.name);
        return entry?.backend === "local";
      });
      const hasMcpCalls = toolCalls.some((toolCall) => {
        const entry = getToolEntry(toolCall.name);
        return entry?.backend === "mcp";
      });
      const toolRunner = await this.getToolRunnerForSession(session);

      if (!toolRunner && !hasLocalCalls && !hasMcpCalls) {
        this.sessionManager.setState(sessionId, "idle");
        return { status: "completed", turnsUsed };
      }

      // Execute tool calls sequentially
      const toolResults = await this.executeToolCalls(sessionId, toolCalls, toolRunner);

      // Persist tool results and continue loop
      for (const result of toolResults) {
        this.sessionManager.appendMessage(sessionId, result);
      }

      if (opts?.maxTurns != null && turnsUsed >= opts.maxTurns) {
        this.sessionManager.setState(sessionId, "idle");
        return { status: "max_turns", turnsUsed };
      }

      // Loop back to stream with updated context
    }
  }

  private extractToolCalls(message: AssistantMessage): ToolCall[] {
    return message.content
      .filter((p): p is ToolCallPart => p.type === "toolCall")
      .map((p) => ({
        toolCallId: p.id,
        name: p.name as ToolCall["name"],
        arguments: p.arguments,
      }));
  }

  private async executeToolCalls(
    sessionId: string,
    toolCalls: ToolCall[],
    toolRunner: ToolRunner | null,
  ): Promise<ToolResultMessage[]> {
    const results: ToolResultMessage[] = [];
    const session = this.sessionManager.getMeta(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const globalPermissions = this.getGlobalPermissionConfig();

    for (const toolCall of toolCalls) {
      const entry = getToolEntry(toolCall.name);
      const isLocalTool = entry?.backend === "local";
      const isMcpTool = entry?.backend === "mcp";

      if (!isLocalTool && !isMcpTool && !toolRunner) {
        const unavailable: ToolResult = {
          toolCallId: toolCall.toolCallId,
          isError: true,
          content: `Tool runner unavailable for ${toolCall.name}`,
        };

        this.sessionManager.setState(sessionId, "tooling");
        this.eventBus.emitAppEvent({
          type: "tool.exec.start",
          sessionId,
          ts: Date.now(),
          toolCall,
        });
        this.eventBus.emitAppEvent({
          type: "tool.exec.end",
          sessionId,
          ts: Date.now(),
          result: unavailable,
        });

        results.push(this.toToolResultMessage(toolCall, unavailable));
        continue;
      }

      const approval = resolveToolApproval(toolCall, session.permissionConfig, globalPermissions);

      if (approval.action === "deny") {
        const denied = makePolicyDeniedResult(toolCall, approval.reason);
        results.push(this.toToolResultMessage(toolCall, denied));
        continue;
      }

      if (approval.action === "confirm") {
        this.sessionManager.setState(sessionId, "awaiting_approval");
        this.eventBus.emitAppEvent({
          type: "approval.requested",
          sessionId,
          ts: Date.now(),
          toolCall,
        });

        const decision = await this.waitForApproval(sessionId, toolCall);

        this.eventBus.emitAppEvent({
          type: "approval.resolved",
          sessionId,
          ts: Date.now(),
          toolCallId: toolCall.toolCallId,
          decision,
        });

        if (decision === "denied") {
          const denied = makeDeniedResult(toolCall);
          results.push(this.toToolResultMessage(toolCall, denied));
          continue;
        }
      }

      // Execute the tool
      this.sessionManager.setState(sessionId, "tooling");
      this.eventBus.emitAppEvent({
        type: "tool.exec.start",
        sessionId,
        ts: Date.now(),
        toolCall,
      });

      let result: ToolResult;
      if (toolCall.name === "load_skill") {
        result = this.executeLoadSkill(toolCall);
      } else if (toolCall.name === "todo_write") {
        result = this.executeTodoWrite(sessionId, toolCall);
      } else if (toolCall.name === "subagent") {
        result = await this.executeSubagent(session, toolCall);
      } else if (isMcpTool) {
        if (!this.mcpManager) {
          result = {
            toolCallId: toolCall.toolCallId,
            isError: true,
            content: `MCP manager unavailable for ${toolCall.name}`,
          };
        } else {
          const timeoutMs = getToolTimeout(toolCall);
          try {
            let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
            const mcpResult = await Promise.race([
              this.mcpManager.callTool(toolCall.name, toolCall.arguments, {
                toolCallId: toolCall.toolCallId,
                onUpdate: (partial) => {
                  this.eventBus.emitAppEvent({
                    type: "tool.exec.update",
                    sessionId,
                    ts: Date.now(),
                    toolCallId: toolCall.toolCallId,
                    partial,
                  });
                },
              }),
              new Promise<McpCallToolResult>((_resolve, reject) => {
                timeoutHandle = setTimeout(() => {
                  reject(new Error(`MCP tool "${toolCall.name}" timed out after ${timeoutMs}ms`));
                }, timeoutMs);
              }),
            ]).finally(() => {
              if (timeoutHandle) {
                clearTimeout(timeoutHandle);
              }
            });
            result = this.mapMcpToolResult(toolCall.toolCallId, mcpResult);
          } catch (error: unknown) {
            result = {
              toolCallId: toolCall.toolCallId,
              isError: true,
              content: error instanceof Error ? error.message : String(error),
            };
          }
        }
      } else {
        if (!toolRunner) {
          throw new Error(`Tool runner unavailable for ${toolCall.name}`);
        }

        const timeoutMs = getToolTimeout(toolCall);
        result = await toolRunner.execute(
          toolCall.toolCallId,
          toolCall.name,
          toolCall.arguments,
          {
            timeoutMs,
            onUpdate: (partial) => {
              this.eventBus.emitAppEvent({
                type: "tool.exec.update",
                sessionId,
                ts: Date.now(),
                toolCallId: toolCall.toolCallId,
                partial,
              });
            },
          },
        );
      }

      this.eventBus.emitAppEvent({
        type: "tool.exec.end",
        sessionId,
        ts: Date.now(),
        result,
      });

      results.push(this.toToolResultMessage(toolCall, result));
    }

    return results;
  }

  private toToolResultMessage(
    toolCall: ToolCall,
    result: { toolCallId: string; isError: boolean; content: string; details?: unknown },
  ): ToolResultMessage {
    return {
      role: "toolResult",
      id: generateId(),
      toolCallId: toolCall.toolCallId,
      toolName: toolCall.name,
      isError: result.isError,
      content: [{ type: "text", text: result.content }],
      details: result.details,
      ts: Date.now(),
    };
  }

  private mapMcpToolResult(toolCallId: string, mcpResult: McpCallToolResult): ToolResult {
    const textParts = mcpResult.content.map((part) => {
      if (part.type === "text") {
        return part.text;
      }
      if (part.type === "image") {
        return `[image: ${part.mimeType}]`;
      }
      if (part.type === "audio") {
        return `[audio: ${part.mimeType}]`;
      }
      if (part.type === "resource") {
        const mimeType = part.resource.mimeType ? ` ${part.resource.mimeType}` : "";
        return `[resource:${mimeType}]`;
      }
      return `[resource-link: ${part.name}]`;
    });

    return {
      toolCallId,
      isError: mcpResult.isError ?? false,
      content: textParts.join("\n"),
      details: {
        source: "mcp",
        rawContent: mcpResult.content,
        structuredContent: mcpResult.structuredContent,
        meta: mcpResult._meta,
      },
    };
  }

  private waitForApproval(sessionId: string, toolCall: ToolCall): Promise<"approved" | "denied"> {
    return new Promise((resolve) => {
      this.pendingApprovals.set(toolCall.toolCallId, { sessionId, toolCall, resolve });
    });
  }

  async manualCompact(sessionId: string): Promise<ManualCompactResult> {
    const state = this.sessionManager.getState(sessionId);
    if (state !== "idle") {
      throw new Error(`Session ${sessionId} is in state "${state}", expected "idle"`);
    }

    const session = this.sessionManager.getMeta(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const { activeProviderId: providerId, activeModelId: modelId } = session;
    if (!providerId || !modelId) {
      throw new Error("No provider/model configured for session");
    }

    const provider = this.providers.get(providerId);
    if (!provider) {
      throw new Error(`Provider "${providerId}" not found`);
    }

    const apiKey = await provider.getApiKey();
    if (!apiKey) {
      throw new Error(`No API key for provider "${providerId}"`);
    }

    const storedMessages = this.sessionManager.getStoredMessages(sessionId);
    const messages = storedMessages.map(({ message }) => message);

    this.sessionManager.setState(sessionId, "compacting");

    try {
      const result = await executeManualCompact({
        sessionId,
        messages,
        db: this.db,
        adapter: provider.adapter,
        providerConfig: provider.config,
        apiKey,
        providerId,
        modelId,
        transcriptDir: this.compactTranscriptDir,
        transcriptMessages: storedMessages,
      });

      this.sessionManager.setActiveCompact(sessionId, result.compactionId);
      this.eventBus.emitAppEvent({
        type: "compact.manual",
        sessionId,
        ts: Date.now(),
        summaryMessageId: result.compactionId,
        transcriptPath: result.transcriptPath,
      });

      return result;
    } catch (error: unknown) {
      this.eventBus.emitAppEvent({
        type: "compact.failed",
        sessionId,
        ts: Date.now(),
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      this.sessionManager.setState(sessionId, "idle");
    }
  }

  approveToolCall(toolCallId: string): void {
    const pendingApproval = this.pendingApprovals.get(toolCallId);
    if (pendingApproval) {
      const { resolve } = pendingApproval;
      this.pendingApprovals.delete(toolCallId);
      resolve("approved");
    }
  }

  denyToolCall(toolCallId: string): void {
    const pendingApproval = this.pendingApprovals.get(toolCallId);
    if (pendingApproval) {
      const { resolve } = pendingApproval;
      this.pendingApprovals.delete(toolCallId);
      resolve("denied");
    }
  }

  abort(sessionId: string): void {
    const childSessionId = this.activeChildSessions.get(sessionId);
    if (childSessionId) {
      this.abort(childSessionId);
    }

    // Abort streaming
    const controller = this.sessionManager.getAbortController(sessionId);
    if (controller) {
      controller.abort();
      this.eventBus.emitAppEvent({
        type: "session.abort",
        sessionId,
        ts: Date.now(),
      });
    }

    for (const [toolCallId, approval] of this.pendingApprovals.entries()) {
      if (approval.sessionId !== sessionId) {
        continue;
      }

      this.pendingApprovals.delete(toolCallId);
      approval.resolve("denied");
    }

    this.sessionManager.clearAbortController(sessionId);
    this.sessionManager.setState(sessionId, "idle");
  }

  abortAll(): void {
    for (const session of this.sessionManager.list({ archived: false })) {
      const state = this.sessionManager.getState(session.id);
      if (state !== "idle") {
        this.abort(session.id);
      }
    }
  }

  async shutdownRunner(timeoutMs: number): Promise<void> {
    const runners = this.toolRunner != null
      ? [this.toolRunner]
      : Array.from(this.workspaceToolRunners.values());

    if (runners.length === 0) {
      return;
    }

    await Promise.all(runners.map(async (runner) => {
      let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
      try {
        await Promise.race([
          runner.stop(),
          new Promise<void>((resolve) => {
            timeoutHandle = setTimeout(() => {
              console.warn(`Runner shutdown timed out after ${timeoutMs}ms`);
              resolve();
            }, timeoutMs);
          }),
        ]);
      } finally {
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
        }
      }
    }));

    this.workspaceToolRunners.clear();
  }

  private assembleSystemPrompt(session: SessionMeta): string {
    const parts: string[] = ["You are a helpful assistant."];
    if (session.workspaceRoot) {
      parts.push(`Current workspace: ${session.workspaceRoot} (default working directory for tools; relative paths resolve here, but absolute paths may target elsewhere).`);
    }
    const todos = listTodos(this.db, session.id);
    if (todos.length > 0) {
      parts.push([
        "Current todo list:",
        ...todos.map((todo) => `- ${todo.id}: [${todo.status}] ${todo.title}${todo.notes ? ` (${todo.notes})` : ""}`),
      ].join("\n"));
    }
    if (this.skills.length > 0) {
      parts.push(formatSkillList(this.skills));
    }
    if (session.pinnedSystemPrompt) {
      parts.push(session.pinnedSystemPrompt);
    }
    return parts.join("\n\n");
  }

  private getContextMessages(sessionId: string, session: SessionMeta): ScorelMessage[] {
    if (session.activeCompactId) {
      const compaction = getCompaction(this.db, session.activeCompactId);
      if (compaction) {
        const boundarySeq = this.sessionManager.getMessageSeq(sessionId, compaction.boundaryMessageId);
        if (boundarySeq != null) {
          const postBoundaryMessages = this.sessionManager.getMessages(sessionId, boundarySeq);
          return applyMicroCompact(
            applyBoundaryResume(postBoundaryMessages, compaction),
            MICRO_COMPACT_KEEP_RECENT,
          );
        }
      }
    }

    return applyMicroCompact(this.sessionManager.getMessages(sessionId), MICRO_COMPACT_KEEP_RECENT);
  }

  private getAvailableToolDefinitions() {
    const definitions = getToolDefinitions({
      includeRunnerTools: this.toolRunner != null || this.createToolRunner != null,
      includeLoadSkill: true,
      includeSubagent: true,
      includeTodoWrite: true,
    });

    return definitions.length > 0 ? definitions : undefined;
  }

  private async getToolRunnerForSession(session: SessionMeta): Promise<ToolRunner | null> {
    if (this.toolRunner) {
      return this.toolRunner;
    }

    if (!this.createToolRunner) {
      return null;
    }

    const workspaceRoot = session.workspaceRoot?.trim();
    if (!workspaceRoot) {
      return null;
    }

    const existing = this.workspaceToolRunners.get(workspaceRoot);
    if (existing) {
      return existing;
    }

    const runner = await this.createToolRunner(workspaceRoot);
    await runner.start();
    this.workspaceToolRunners.set(workspaceRoot, runner);
    return runner;
  }

  private async maybeAutoCompact(
    sessionId: string,
    session: SessionMeta,
    provider: ProviderEntry,
    apiKey: string,
    assistantMessage: AssistantMessage,
  ): Promise<void> {
    const config = getAutoCompactConfig(session);
    if (!shouldAutoCompact(assistantMessage, session.activeModelId ?? provider.config.models[0]?.id ?? "", config)) {
      return;
    }

    const storedMessages = this.sessionManager.getStoredMessages(sessionId);
    const messages = storedMessages.map(({ message }) => message);
    this.sessionManager.setState(sessionId, "compacting");

    try {
      const result = await runAutoCompact(
        {
          db: this.db,
          adapter: provider.adapter,
          providerConfig: provider.config,
          apiKey,
          providerId: provider.config.id,
          modelId: session.activeModelId ?? provider.config.models[0]?.id ?? "",
          transcriptDir: this.compactTranscriptDir,
        },
        {
          sessionId,
          messages,
          storedMessages,
        },
      );

      this.sessionManager.setActiveCompact(sessionId, result.compactionId);
      this.eventBus.emitAppEvent({
        type: "compact.auto",
        sessionId,
        ts: Date.now(),
        summaryMessageId: result.compactionId,
        transcriptPath: result.transcriptPath,
      });
    } catch (error: unknown) {
      console.error("[auto-compact] Failed for session", sessionId, error);
      this.eventBus.emitAppEvent({
        type: "compact.failed",
        sessionId,
        ts: Date.now(),
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      this.sessionManager.setState(sessionId, "idle");
    }
  }

  private executeTodoWrite(sessionId: string, toolCall: ToolCall): ToolResult {
    try {
      const operation = typeof toolCall.arguments.operation === "string"
        ? toolCall.arguments.operation
        : null;

      if (!operation) {
        return {
          toolCallId: toolCall.toolCallId,
          isError: true,
          content: 'Invalid todo_write arguments: expected string "operation"',
        };
      }

      if (operation === "create") {
        const title = typeof toolCall.arguments.title === "string" ? toolCall.arguments.title.trim() : "";
        if (!title) {
          return {
            toolCallId: toolCall.toolCallId,
            isError: true,
            content: 'Invalid todo_write create arguments: expected non-empty string "title"',
          };
        }

        const todo = createTodo(this.db, {
          id: generateId(),
          sessionId,
          title,
          notes: typeof toolCall.arguments.notes === "string" ? toolCall.arguments.notes : undefined,
        });
        this.emitTodoUpdated(sessionId);
        return {
          toolCallId: toolCall.toolCallId,
          isError: false,
          content: `Created todo: ${todo.title}`,
          details: todo,
        };
      }

      if (operation === "update") {
        const id = typeof toolCall.arguments.id === "string" ? toolCall.arguments.id : "";
        if (!id) {
          return {
            toolCallId: toolCall.toolCallId,
            isError: true,
            content: 'Invalid todo_write update arguments: expected string "id"',
          };
        }

        const todo = updateTodo(this.db, {
          id,
          title: typeof toolCall.arguments.title === "string" ? toolCall.arguments.title : undefined,
          status: toolCall.arguments.status === "pending"
            || toolCall.arguments.status === "in_progress"
            || toolCall.arguments.status === "done"
            ? toolCall.arguments.status
            : undefined,
          notes: typeof toolCall.arguments.notes === "string"
            ? toolCall.arguments.notes
            : toolCall.arguments.notes === null
              ? null
              : undefined,
        });

        if (!todo) {
          return {
            toolCallId: toolCall.toolCallId,
            isError: true,
            content: `Todo not found: ${id}`,
          };
        }

        this.emitTodoUpdated(sessionId);
        return {
          toolCallId: toolCall.toolCallId,
          isError: false,
          content: `Updated todo: ${todo.title}`,
          details: todo,
        };
      }

      if (operation === "delete") {
        const id = typeof toolCall.arguments.id === "string" ? toolCall.arguments.id : "";
        if (!id) {
          return {
            toolCallId: toolCall.toolCallId,
            isError: true,
            content: 'Invalid todo_write delete arguments: expected string "id"',
          };
        }

        const deleted = deleteTodo(this.db, id);
        if (!deleted) {
          return {
            toolCallId: toolCall.toolCallId,
            isError: true,
            content: `Todo not found: ${id}`,
          };
        }

        this.emitTodoUpdated(sessionId);
        return {
          toolCallId: toolCall.toolCallId,
          isError: false,
          content: `Deleted todo: ${id}`,
        };
      }

      if (operation === "list") {
        const todos = listTodos(this.db, sessionId);
        return {
          toolCallId: toolCall.toolCallId,
          isError: false,
          content: todos.length === 0
            ? "No todos"
            : todos.map((todo) => `- [${todo.status}] ${todo.title}${todo.notes ? ` (${todo.notes})` : ""}`).join("\n"),
          details: todos,
        };
      }

      return {
        toolCallId: toolCall.toolCallId,
        isError: true,
        content: `Unsupported todo_write operation: ${operation}`,
      };
    } catch (error: unknown) {
      return {
        toolCallId: toolCall.toolCallId,
        isError: true,
        content: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async executeSubagent(session: SessionMeta, toolCall: ToolCall): Promise<ToolResult> {
    if (!canSpawnSubagent(session)) {
      return makeSubagentErrorResult(toolCall.toolCallId, "Nested subagents are not supported in V1.");
    }

    const task = typeof toolCall.arguments.task === "string" ? toolCall.arguments.task.trim() : "";
    if (!task) {
      return makeSubagentErrorResult(toolCall.toolCallId, 'Invalid subagent arguments: expected non-empty string "task"');
    }

    const providerId = session.activeProviderId;
    const modelId = session.activeModelId;
    if (!providerId || !modelId) {
      return makeSubagentErrorResult(toolCall.toolCallId, "Subagent requires an active provider and model.");
    }

    const provider = this.providers.get(providerId);
    if (!provider) {
      return makeSubagentErrorResult(toolCall.toolCallId, `Provider not found: ${providerId}`);
    }

    if (!await provider.getApiKey()) {
      return makeSubagentErrorResult(toolCall.toolCallId, `No API key for provider "${providerId}"`);
    }

    const childSessionId = this.sessionManager.create(session.workspaceRoot, {
      providerId,
      modelId,
      parentSessionId: session.id,
      permissionConfig: session.permissionConfig,
    });
    const maxTurns = getSubagentMaxTurns(toolCall.arguments.max_turns);

    this.eventBus.emitAppEvent({
      type: "subagent.start",
      sessionId: session.id,
      ts: Date.now(),
      childSessionId,
      task,
    });

    this.activeChildSessions.set(session.id, childSessionId);

    try {
      const outcome = await this.runSessionPrompt(childSessionId, task, { maxTurns });
      const summary = summarizeChildMessages(this.sessionManager.getMessages(childSessionId));

      this.eventBus.emitAppEvent({
        type: "subagent.done",
        sessionId: session.id,
        ts: Date.now(),
        childSessionId,
        status: outcome.status,
        turnsUsed: outcome.turnsUsed,
      });

      return {
        toolCallId: toolCall.toolCallId,
        isError: false,
        content: summary,
        details: {
          childSessionId,
          turnsUsed: outcome.turnsUsed,
          status: outcome.status,
        },
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.eventBus.emitAppEvent({
        type: "subagent.done",
        sessionId: session.id,
        ts: Date.now(),
        childSessionId,
        status: "error",
        turnsUsed: 0,
      });
      return makeSubagentErrorResult(toolCall.toolCallId, `Subagent failed: ${message}`);
    } finally {
      this.activeChildSessions.delete(session.id);
    }
  }

  private emitTodoUpdated(sessionId: string): void {
    this.eventBus.emitAppEvent({
      type: "todo.updated",
      sessionId,
      ts: Date.now(),
      todos: listTodos(this.db, sessionId),
    });
  }

  private executeLoadSkill(toolCall: ToolCall): ToolResult {
    const name = typeof toolCall.arguments.name === "string"
      ? toolCall.arguments.name
      : null;

    if (!name) {
      return {
        toolCallId: toolCall.toolCallId,
        isError: true,
        content: 'Invalid load_skill arguments: expected a string "name"',
      };
    }

    const result = loadSkill(this.skills, name);
    return {
      toolCallId: toolCall.toolCallId,
      isError: result.isError,
      content: result.content,
    };
  }
}
