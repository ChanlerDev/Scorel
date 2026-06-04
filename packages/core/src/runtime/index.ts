import type {
  ScorelMessage,
  StopReason,
  ToolCallContentBlock,
  ToolResultContentBlock,
  Usage,
} from "@scorel/protocol";

import type { AgentTool, ToolResult } from "../tools/index.js";

export type RuntimeTurnOptions = {
  refreshContext?: (context: ScorelMessage[]) => ScorelMessage[] | Promise<ScorelMessage[]>;
};

export type ProviderStreamChunk = {
  type: "text_delta";
  delta: string;
};

export type RuntimeProviderTurn = {
  context: ScorelMessage[];
  systemPrompt: string | undefined;
  tools: AgentTool[];
  signal: AbortSignal;
  options: RuntimeTurnOptions;
};

export type RuntimeProvider = {
  streamTurn(turn: RuntimeProviderTurn): AsyncGenerator<ProviderStreamChunk, ScorelMessage | void, undefined>;
};

export type RawRuntimeEvent =
  | { type: "turn_start" }
  | { type: "turn_end"; usage?: Usage; stopReason?: StopReason }
  | { type: "message_start"; role: "assistant" | "tool_result" }
  | { type: "text_delta"; delta: string }
  | { type: "message_end"; message: ScorelMessage & { role: "assistant" } }
  | { type: "tool_execution_start"; toolCallId: string; toolName: string; args: unknown }
  | {
      type: "tool_execution_end";
      toolCallId: string;
      toolName: string;
      durationMs: number;
      isError: boolean;
      result: ToolResult;
    }
  | { type: "error"; error: Error };

type ProviderTurnResult = {
  message?: ScorelMessage & { role: "assistant" };
  finished?: boolean;
  stopReason?: StopReason;
};

export class ScorelRuntime {
  readonly #provider: RuntimeProvider;
  readonly #tools = new Map<string, AgentTool>();
  #controller: AbortController | undefined;

  constructor({ provider }: { provider: RuntimeProvider }) {
    this.#provider = provider;
  }

  get running(): boolean {
    return this.#controller !== undefined;
  }

  registerTool(tool: AgentTool): void {
    this.#tools.set(tool.name, tool);
  }

  unregisterTool(name: string): void {
    this.#tools.delete(name);
  }

  cancel(): void {
    this.#controller?.abort();
  }

  async *executeTurn(
    context: ScorelMessage[],
    systemPrompt: string | undefined,
    options: RuntimeTurnOptions,
  ): AsyncGenerator<RawRuntimeEvent, void, undefined> {
    if (this.#controller) {
      throw new Error("Runtime is already running");
    }

    const controller = new AbortController();
    this.#controller = controller;

    yield { type: "turn_start" };

    try {
      let nextContext = [...context];

      while (!controller.signal.aborted) {
        const result = yield* this.#runProviderTurn(nextContext, systemPrompt, options, controller.signal);
        if (result.finished) {
          return;
        }

        const assistant = result.message;
        if (!assistant) {
          yield { type: "turn_end", stopReason: result.stopReason ?? "end_turn" };
          return;
        }

        const toolCalls = assistant.content.filter(
          (block): block is ToolCallContentBlock => block.type === "tool_call",
        );

        if (controller.signal.aborted || toolCalls.length === 0 || assistant.stopReason !== "tool_call") {
          yield { type: "turn_end", stopReason: controller.signal.aborted ? "cancelled" : assistant.stopReason };
          return;
        }

        const toolMessages: ScorelMessage[] = [];
        for (const toolCall of toolCalls) {
          if (controller.signal.aborted) {
            break;
          }
          toolMessages.push(yield* this.#executeTool(toolCall, controller.signal));
        }

        if (controller.signal.aborted) {
          yield { type: "turn_end", stopReason: "cancelled" };
          return;
        }

        const contextAfterTools = [...nextContext, assistant, ...toolMessages];
        nextContext = options.refreshContext ? await options.refreshContext(contextAfterTools) : contextAfterTools;
      }

      yield { type: "turn_end", stopReason: "cancelled" };
    } finally {
      this.#controller = undefined;
    }
  }

  async *#runProviderTurn(
    context: ScorelMessage[],
    systemPrompt: string | undefined,
    options: RuntimeTurnOptions,
    signal: AbortSignal,
  ): AsyncGenerator<RawRuntimeEvent, ProviderTurnResult, undefined> {
    let text = "";

    yield { type: "message_start", role: "assistant" };

    try {
      const stream = this.#provider.streamTurn({
        context,
        systemPrompt,
        tools: [...this.#tools.values()],
        signal,
        options,
      });

      while (true) {
        if (signal.aborted) {
          break;
        }

        const next = await stream.next();
        if (next.done) {
          const message = normalizeAssistantMessage(next.value, text, signal.aborted ? "cancelled" : "end_turn");
          if (message) {
            yield { type: "message_end", message };
          }
          return { message, stopReason: message?.stopReason ?? "end_turn" };
        }

        if (next.value.type === "text_delta") {
          text += next.value.delta;
          yield next.value;
        }
      }

      const cancelledMessage = partialAssistantMessage(text, "cancelled");
      if (cancelledMessage) {
        yield { type: "message_end", message: cancelledMessage };
      }
      return { stopReason: "cancelled" };
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error(String(cause));
      const partial = partialAssistantMessage(text, "error");
      if (partial) {
        yield { type: "message_end", message: partial };
      }
      yield { type: "error", error };
      yield { type: "turn_end", stopReason: "error" };
      return { finished: true };
    }
  }

  async *#executeTool(
    toolCall: ToolCallContentBlock,
    signal: AbortSignal,
  ): AsyncGenerator<RawRuntimeEvent, ScorelMessage, undefined> {
    const start = Date.now();
    const tool = this.#tools.get(toolCall.toolName);
    yield {
      type: "tool_execution_start",
      toolCallId: toolCall.toolCallId,
      toolName: toolCall.toolName,
      args: toolCall.args,
    };

    let result: ToolResult;
    let isError = false;
    try {
      if (!tool) {
        throw new Error(`Unknown tool: ${toolCall.toolName}`);
      }
      result = await tool.execute(toolCall.toolCallId, toolCall.args, signal, () => undefined);
    } catch (cause) {
      isError = true;
      const message = cause instanceof Error ? cause.message : String(cause);
      result = { content: [{ type: "text", text: message }] };
    }

    yield {
      type: "tool_execution_end",
      toolCallId: toolCall.toolCallId,
      toolName: toolCall.toolName,
      durationMs: Date.now() - start,
      isError,
      result,
    };

    const block: ToolResultContentBlock = {
      type: "tool_result",
      toolCallId: toolCall.toolCallId,
      toolName: toolCall.toolName,
      result,
      isError,
    };

    return {
      role: "tool_result",
      content: [block],
    };
  }
}

const normalizeAssistantMessage = (
  value: ScorelMessage | void,
  text: string,
  fallbackStopReason: StopReason,
): (ScorelMessage & { role: "assistant" }) | undefined => {
  if (value) {
    if (!isAssistantMessage(value)) {
      throw new Error(`Provider returned ${value.role} message instead of assistant`);
    }
    return value;
  }
  return partialAssistantMessage(text, fallbackStopReason);
};

const isAssistantMessage = (message: ScorelMessage): message is ScorelMessage & { role: "assistant" } =>
  message.role === "assistant";

const partialAssistantMessage = (
  text: string,
  stopReason: StopReason,
): (ScorelMessage & { role: "assistant" }) | undefined => {
  if (text.length === 0) {
    return undefined;
  }
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    stopReason,
    meta: stopReason === "end_turn" ? undefined : { partial: true },
  };
};
