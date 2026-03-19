import crypto from "node:crypto";
import type {
  ProviderConfig,
  ScorelMessage,
  UserMessage,
  AssistantMessage,
  SessionDetail,
} from "../../shared/types.js";
import type { AssistantMessageEvent, ScorelEvent } from "../../shared/events.js";
import { NANOID_LENGTH } from "../../shared/constants.js";
import type { ProviderAdapter, ProviderRequestOptions } from "../provider/types.js";
import { SessionManager } from "./session-manager.js";
import { EventBus } from "./event-bus.js";

function generateId(): string {
  return crypto.randomBytes(16).toString("base64url").slice(0, NANOID_LENGTH);
}

export type ProviderEntry = {
  config: ProviderConfig;
  adapter: ProviderAdapter;
  getApiKey: () => Promise<string | null>;
};

export class Orchestrator {
  private readonly sessionManager: SessionManager;
  private readonly eventBus: EventBus;
  private readonly providers: Map<string, ProviderEntry>;

  constructor(opts: {
    sessionManager: SessionManager;
    eventBus: EventBus;
    providers: Map<string, ProviderEntry>;
  }) {
    this.sessionManager = opts.sessionManager;
    this.eventBus = opts.eventBus;
    this.providers = opts.providers;
  }

  async send(sessionId: string, text: string): Promise<void> {
    // 1. Validate state is idle
    const state = this.sessionManager.getState(sessionId);
    if (state !== "idle") {
      throw new Error(`Session ${sessionId} is in state "${state}", expected "idle"`);
    }

    // 2. Resolve session + provider
    const session = this.sessionManager.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    const { activeProviderId: providerId, activeModelId: modelId } = session;
    if (!providerId || !modelId) {
      throw new Error("No provider/model configured for session");
    }

    const provider = this.providers.get(providerId);
    if (!provider) throw new Error(`Provider "${providerId}" not found`);

    // 3. Get API key
    const apiKey = await provider.getApiKey();
    if (!apiKey) throw new Error(`No API key for provider "${providerId}"`);

    // 4. Persist user message + emit event
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

    // 5. Assemble context
    const messages = this.sessionManager.getMessages(sessionId);
    const systemPrompt = this.assembleSystemPrompt(session);

    // 6. Transition to streaming + wire abort
    this.sessionManager.setState(sessionId, "streaming");
    const abortController = new AbortController();
    this.sessionManager.setAbortController(sessionId, abortController);

    // 7. Emit llm.request
    this.eventBus.emitAppEvent({
      type: "llm.request",
      sessionId,
      ts: Date.now(),
      providerId,
      modelId,
      api: provider.config.api,
    });

    // 8. Stream
    try {
      const assistantMessage = await provider.adapter.stream(
        provider.config,
        apiKey,
        {
          systemPrompt,
          messages,
          providerId,
          modelId,
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

      // 9. Persist result
      if (assistantMessage.stopReason === "aborted") {
        const hasVisibleOutput = assistantMessage.content.some(
          (p) => p.type === "text" && p.text.length > 0,
        );
        if (hasVisibleOutput) {
          this.sessionManager.appendMessage(sessionId, assistantMessage);
        }
      } else {
        this.sessionManager.appendMessage(sessionId, assistantMessage);
        this.eventBus.emitAppEvent({
          type: "llm.done",
          sessionId,
          ts: Date.now(),
          message: assistantMessage,
        });
      }
    } finally {
      this.sessionManager.clearAbortController(sessionId);
      this.sessionManager.setState(sessionId, "idle");
    }
  }

  abort(sessionId: string): void {
    const controller = this.sessionManager.getAbortController(sessionId);
    if (controller) {
      controller.abort();
      this.eventBus.emitAppEvent({
        type: "session.abort",
        sessionId,
        ts: Date.now(),
      });
    }
  }

  private assembleSystemPrompt(session: SessionDetail): string {
    const parts: string[] = ["You are a helpful assistant."];
    if (session.workspaceRoot) {
      parts.push(`Current workspace: ${session.workspaceRoot}`);
    }
    if (session.pinnedSystemPrompt) {
      parts.push(session.pinnedSystemPrompt);
    }
    return parts.join("\n\n");
  }
}
