import type Database from "better-sqlite3";
import type {
  ManualCompactResult,
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
} from "../../shared/types.js";
import type { AssistantMessageEvent } from "../../shared/events.js";
import { MICRO_COMPACT_KEEP_RECENT } from "../../shared/constants.js";
import type { ProviderAdapter } from "../provider/types.js";
import { SessionManager } from "./session-manager.js";
import { EventBus } from "./event-bus.js";
import type { ToolRunner } from "../runner/runner-protocol.js";
import {
  requiresApproval,
  getToolTimeout,
  makeDeniedResult,
  getToolDefinitions,
} from "./tool-dispatch.js";
import {
  applyBoundaryResume,
  applyMicroCompact,
  executeManualCompact,
} from "./compact.js";
import { generateId } from "./id.js";
import { getCompaction } from "../storage/compactions.js";
import { formatSkillList, loadSkill } from "../skills/skill-loader.js";

export type ProviderEntry = {
  config: ProviderConfig;
  adapter: ProviderAdapter;
  getApiKey: () => Promise<string | null>;
};

type ApprovalRequest = {
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
  private readonly workspaceToolRunners = new Map<string, ToolRunner>();
  private pendingApproval: ApprovalRequest | null = null;

  constructor(opts: {
    db: Database.Database;
    sessionManager: SessionManager;
    eventBus: EventBus;
    providers: Map<string, ProviderEntry>;
    toolRunner?: ToolRunner;
    createToolRunner?: (workspaceRoot: string) => Promise<ToolRunner>;
    skills?: SkillMeta[];
    compactTranscriptDir?: string;
  }) {
    this.db = opts.db;
    this.sessionManager = opts.sessionManager;
    this.eventBus = opts.eventBus;
    this.providers = opts.providers;
    this.toolRunner = opts.toolRunner ?? null;
    this.createToolRunner = opts.createToolRunner ?? null;
    this.skills = opts.skills ?? [];
    this.compactTranscriptDir = opts.compactTranscriptDir;
  }

  async send(sessionId: string, text: string): Promise<void> {
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
      await this.modelLoop(sessionId, provider, apiKey);
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
  ): Promise<void> {
    while (true) {
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
        return;
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
        this.sessionManager.setState(sessionId, "idle");
        return;
      }

      // Extract tool calls
      const toolCalls = this.extractToolCalls(assistantMessage);
      if (toolCalls.length === 0) {
        this.sessionManager.setState(sessionId, "idle");
        return;
      }

      const hasSkillCalls = toolCalls.some((toolCall) => toolCall.name === "load_skill");
      const toolRunner = await this.getToolRunnerForSession(session);

      if (!toolRunner && !hasSkillCalls) {
        this.sessionManager.setState(sessionId, "idle");
        return;
      }

      // Execute tool calls sequentially
      const toolResults = await this.executeToolCalls(sessionId, toolCalls, toolRunner);

      // Persist tool results and continue loop
      for (const result of toolResults) {
        this.sessionManager.appendMessage(sessionId, result);
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

    for (const toolCall of toolCalls) {
      if (toolCall.name !== "load_skill" && !toolRunner) {
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

      // Check if approval is needed
      if (requiresApproval(toolCall)) {
        this.sessionManager.setState(sessionId, "awaiting_approval");
        this.eventBus.emitAppEvent({
          type: "approval.requested",
          sessionId,
          ts: Date.now(),
          toolCall,
        });

        const decision = await this.waitForApproval(toolCall);

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
      details: result.details as ToolResultMessage["details"],
      ts: Date.now(),
    };
  }

  private waitForApproval(toolCall: ToolCall): Promise<"approved" | "denied"> {
    return new Promise((resolve) => {
      this.pendingApproval = { toolCall, resolve };
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
    if (this.pendingApproval && this.pendingApproval.toolCall.toolCallId === toolCallId) {
      const { resolve } = this.pendingApproval;
      this.pendingApproval = null;
      resolve("approved");
    }
  }

  denyToolCall(toolCallId: string): void {
    if (this.pendingApproval && this.pendingApproval.toolCall.toolCallId === toolCallId) {
      const { resolve } = this.pendingApproval;
      this.pendingApproval = null;
      resolve("denied");
    }
  }

  abort(sessionId: string): void {
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

    // Deny pending approval
    if (this.pendingApproval) {
      const { resolve } = this.pendingApproval;
      this.pendingApproval = null;
      resolve("denied");
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
      parts.push(`Current workspace: ${session.workspaceRoot}`);
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
