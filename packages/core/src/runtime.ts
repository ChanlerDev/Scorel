import { streamSimple as defaultStreamSimple, validateToolCall } from "./llm.js";
import type {
  ScorelEvent,
  ScorelEventListener,
  ScorelMessage,
  ScorelRuntimeHooks,
  ScorelRuntimeOptions,
  ScorelRuntimeState,
  ScorelStreamSimple,
  ScorelTool,
  ScorelToolResult
} from "./types.js";
import type { Api, AssistantMessage, Context, Message, Model, ToolCall, ToolResultMessage } from "./llm.js";

export class ScorelRuntime {
  readonly state: ScorelRuntimeState;

  private readonly model: Model<Api>;
  private readonly systemPrompt?: string;
  private readonly streamOptions: ScorelRuntimeOptions["streamOptions"];
  private readonly streamSimple: ScorelStreamSimple;
  private readonly tools: ScorelTool[];
  private readonly hooks: ScorelRuntimeHooks;
  private readonly listeners = new Set<ScorelEventListener>();
  private readonly steeringQueue: ScorelMessage[] = [];
  private readonly followUpQueue: ScorelMessage[] = [];
  private idlePromise: Promise<void> = Promise.resolve();
  private abortController?: AbortController;

  constructor(options: ScorelRuntimeOptions) {
    this.model = options.model;
    this.systemPrompt = options.systemPrompt;
    this.streamOptions = options.streamOptions;
    this.streamSimple = options.streamSimple ?? defaultStreamSimple;
    this.tools = options.tools ?? [];
    this.hooks = options.hooks ?? {};
    this.state = {
      status: "idle",
      sessionId: options.sessionId ?? "default",
      messages: options.messages ? [...options.messages] : []
    };
  }

  prompt(message: string | ScorelMessage | ScorelMessage[]): Promise<void> {
    if (this.state.status !== "idle") {
      throw new Error("ScorelRuntime.prompt() can only start while idle");
    }

    const run = this.run(toMessages(message));
    this.idlePromise = run;
    return run;
  }

  continue(): Promise<void> {
    if (this.state.status !== "idle") {
      throw new Error("ScorelRuntime.continue() can only start while idle");
    }

    const run = this.run([]);
    this.idlePromise = run;
    return run;
  }

  steer(message: string | ScorelMessage | ScorelMessage[]): void {
    this.steeringQueue.push(...toMessages(message));
  }

  followUp(message: string | ScorelMessage | ScorelMessage[]): void {
    this.followUpQueue.push(...toMessages(message));
  }

  abort(): void {
    this.abortController?.abort();
  }

  waitForIdle(): Promise<void> {
    return this.idlePromise;
  }

  subscribe(listener: ScorelEventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  loadMessages(messages: ScorelMessage[]): void {
    if (this.state.status !== "idle") {
      throw new Error("ScorelRuntime.loadMessages() can only run while idle");
    }
    this.state.messages.splice(0, this.state.messages.length, ...messages);
    this.state.lastError = undefined;
  }

  private async run(input: ScorelMessage[]): Promise<void> {
    this.state.status = "running";
    this.state.lastError = undefined;
    this.abortController = new AbortController();

    try {
      this.state.messages.push(...input);
      await this.emit({ type: "runtime_start", sessionId: this.state.sessionId });

      let pendingMessages: ScorelMessage[] = [];
      let turnIndex = 0;

      while (true) {
        if (pendingMessages.length > 0) {
          this.state.messages.push(...pendingMessages);
          pendingMessages = [];
        }

        turnIndex += 1;
        const assistant = await this.runAssistantTurn(turnIndex);
        this.state.messages.push(assistant);
        await this.emit({ type: "message_end", sessionId: this.state.sessionId, message: assistant });

        const toolCalls = collectToolCalls(assistant);
        if (toolCalls.length > 0) {
          const toolResults = await this.executeToolCalls(toolCalls);
          this.state.messages.push(...toolResults);
        }

        await this.emit({
          type: "turn_end",
          sessionId: this.state.sessionId,
          usage: assistant.usage,
          stopReason: assistant.stopReason
        });

        const prepared = await this.hooks.prepareNextTurn?.({ turnIndex, messages: this.state.messages });
        if (prepared?.length) {
          pendingMessages.push(...prepared);
        }

        const steering = this.drain(this.steeringQueue);
        if (steering.length > 0) {
          pendingMessages.push(...steering);
          continue;
        }

        if (toolCalls.length > 0) {
          continue;
        }

        if (await this.hooks.shouldStopAfterTurn?.({ turnIndex, messages: this.state.messages })) {
          break;
        }

        const followUps = this.drain(this.followUpQueue);
        if (followUps.length > 0) {
          pendingMessages.push(...followUps);
          continue;
        }

        break;
      }

      await this.emit({
        type: "runtime_end",
        sessionId: this.state.sessionId,
        error: this.state.lastError
      });
      this.state.status = "idle";
    } catch (error) {
      this.state.lastError = error instanceof Error ? error.message : String(error);
      this.state.status = "error";
      await this.emit({
        type: "runtime_end",
        sessionId: this.state.sessionId,
        error: this.state.lastError
      });
      throw error;
    } finally {
      this.abortController = undefined;
      if (this.state.status === "running" || this.state.lastError) {
        this.state.status = this.state.lastError ? "idle" : "idle";
      }
    }
  }

  private async runAssistantTurn(turnIndex: number): Promise<AssistantMessage> {
    await this.emit({ type: "turn_start", sessionId: this.state.sessionId });

    const context = await this.buildContext();
    const stream = this.streamSimple(this.model, context, {
      ...this.streamOptions,
      signal: this.abortController?.signal
    });
    let finalMessage: AssistantMessage | undefined;
    const emittedTextContent = new Set<number>();

    for await (const event of stream) {
      if (event.type === "start") {
        await this.emit({
          type: "message_start",
          sessionId: this.state.sessionId,
          message: event.partial
        });
        continue;
      }

      if (event.type === "text_delta" || event.type === "thinking_delta" || event.type === "toolcall_delta") {
        await this.emit({
          type: "message_update",
          sessionId: this.state.sessionId,
          message: event.partial,
          delta: event.delta,
          source: event.type
        });
        if (event.type === "text_delta" && event.delta.length > 0) {
          emittedTextContent.add(event.contentIndex);
        }
        continue;
      }

      if (event.type === "text_end" && event.content.length > 0 && !emittedTextContent.has(event.contentIndex)) {
        await this.emit({
          type: "message_update",
          sessionId: this.state.sessionId,
          message: event.partial,
          delta: event.content,
          source: event.type
        });
        emittedTextContent.add(event.contentIndex);
        continue;
      }

      if (event.type === "done") {
        finalMessage = event.message;
        await this.emitUnemittedText(event.message, emittedTextContent, event.type);
        continue;
      }

      if (event.type === "error") {
        finalMessage = event.error;
        this.state.lastError = event.error.errorMessage ?? event.reason;
        await this.emitUnemittedText(event.error, emittedTextContent, event.type);
      }
    }

    finalMessage ??= await stream.result();
    if (finalMessage.stopReason === "aborted") {
      this.state.lastError = finalMessage.errorMessage ?? "Request aborted";
    }
    void turnIndex;
    return finalMessage;
  }

  private async buildContext(): Promise<Context> {
    const messages = this.hooks.convertToLlm
      ? await this.hooks.convertToLlm(this.state.messages)
      : convertToLlm(this.state.messages);
    const context: Context = {
      systemPrompt: this.systemPrompt,
      messages,
      tools: this.tools.length > 0 ? this.tools : undefined
    };
    return this.hooks.buildContext ? this.hooks.buildContext({ messages: this.state.messages, context }) : context;
  }

  private async executeToolCalls(toolCalls: ToolCall[]): Promise<ToolResultMessage[]> {
    const results: ToolResultMessage[] = [];
    for (const toolCall of toolCalls) {
      const result = await this.executeToolCall(toolCall);
      results.push(result);
      await this.emit({ type: "message_end", sessionId: this.state.sessionId, message: result });
    }
    return results;
  }

  private async executeToolCall(toolCall: ToolCall): Promise<ToolResultMessage> {
    const startedAt = Date.now();
    const tool = this.tools.find((candidate) => candidate.name === toolCall.name);
    let args = toolCall.arguments;

    if (!tool) {
      const result = errorResult(`Tool not found: ${toolCall.name}`);
      await this.emitToolEvents(toolCall, toolCall.arguments, result);
      return toToolResultMessage(toolCall, result, startedAt);
    }

    try {
      args = validateToolCall(this.tools, toolCall) as Record<string, unknown>;
      const decision = await this.hooks.beforeToolCall?.({
        tool,
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        args
      });
      args = decision?.args ?? args;

      await this.emit({ type: "tool_execution_start", sessionId: this.state.sessionId, toolCallId: toolCall.id, toolName: toolCall.name, args });
      let result = await tool.execute({
        toolCallId: toolCall.id,
        args,
        signal: this.abortController?.signal ?? new AbortController().signal,
        update: async (partial) => {
          await this.emit({ type: "tool_execution_update", sessionId: this.state.sessionId, toolCallId: toolCall.id, partial });
        }
      });
      result = (await this.hooks.afterToolCall?.({ tool, toolCallId: toolCall.id, toolName: toolCall.name, args, result })) ?? result;
      await this.emit({
        type: "tool_execution_end",
        sessionId: this.state.sessionId,
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        result
      });
      return toToolResultMessage(toolCall, result, startedAt);
    } catch (error) {
      const result = errorResult(error instanceof Error ? error.message : String(error));
      await this.emit({
        type: "tool_execution_start",
        sessionId: this.state.sessionId,
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        args
      });
      await this.emit({
        type: "tool_execution_end",
        sessionId: this.state.sessionId,
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        result
      });
      return toToolResultMessage(toolCall, result, startedAt);
    }
  }

  private async emitToolEvents(toolCall: ToolCall, args: unknown, result: ScorelToolResult): Promise<void> {
    await this.emit({
      type: "tool_execution_start",
      sessionId: this.state.sessionId,
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      args
    });
    await this.emit({
      type: "tool_execution_end",
      sessionId: this.state.sessionId,
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      result
    });
  }

  private drain(queue: ScorelMessage[]): ScorelMessage[] {
    return queue.splice(0, queue.length);
  }

  private async emit(event: ScorelEvent): Promise<void> {
    for (const listener of this.listeners) {
      await listener(event);
    }
  }

  private async emitUnemittedText(
    message: AssistantMessage,
    emittedTextContent: Set<number>,
    source: "done" | "error"
  ): Promise<void> {
    for (const [index, content] of message.content.entries()) {
      if (content.type !== "text" || content.text.length === 0 || emittedTextContent.has(index)) {
        continue;
      }
      await this.emit({
        type: "message_update",
        sessionId: this.state.sessionId,
        message,
        delta: content.text,
        source
      });
      emittedTextContent.add(index);
    }
  }
}

export function convertToLlm(messages: ScorelMessage[]): Message[] {
  return messages.filter((message): message is Message => {
    return message.role === "user" || message.role === "assistant" || message.role === "toolResult";
  });
}

function collectToolCalls(message: AssistantMessage): ToolCall[] {
  return message.content.filter((content): content is ToolCall => content.type === "toolCall");
}

function errorResult(message: string): ScorelToolResult {
  return { content: [{ type: "text", text: message }], details: { error: message }, isError: true };
}

function toToolResultMessage(toolCall: ToolCall, result: ScorelToolResult, timestamp: number): ToolResultMessage {
  return {
    role: "toolResult",
    toolCallId: toolCall.id,
    toolName: toolCall.name,
    content: result.content,
    details: result.details,
    isError: result.isError ?? false,
    timestamp
  };
}

function toMessages(input: string | ScorelMessage | ScorelMessage[]): ScorelMessage[] {
  if (typeof input === "string") {
    return [{ role: "user", content: input, timestamp: Date.now() }];
  }
  return Array.isArray(input) ? input : [input];
}
