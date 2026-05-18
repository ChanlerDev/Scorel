import { streamSimple as defaultStreamSimple } from "./llm.js";
import type {
  ScorelEvent,
  ScorelEventListener,
  ScorelMessage,
  ScorelRuntimeOptions,
  ScorelRuntimeState,
  ScorelStreamSimple
} from "./types.js";
import type { Api, AssistantMessage, Context, Message, Model } from "./llm.js";

export class ScorelRuntime {
  readonly state: ScorelRuntimeState;

  private readonly model: Model<Api>;
  private readonly systemPrompt?: string;
  private readonly streamOptions: ScorelRuntimeOptions["streamOptions"];
  private readonly streamSimple: ScorelStreamSimple;
  private readonly listeners = new Set<ScorelEventListener>();
  private idlePromise: Promise<void> = Promise.resolve();

  constructor(options: ScorelRuntimeOptions) {
    this.model = options.model;
    this.systemPrompt = options.systemPrompt;
    this.streamOptions = options.streamOptions;
    this.streamSimple = options.streamSimple ?? defaultStreamSimple;
    this.state = {
      status: "idle",
      sessionId: options.sessionId ?? "default",
      messages: []
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

  waitForIdle(): Promise<void> {
    return this.idlePromise;
  }

  subscribe(listener: ScorelEventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private async run(input: ScorelMessage[]): Promise<void> {
    this.state.status = "running";
    this.state.lastError = undefined;

    try {
      this.state.messages.push(...input);
      await this.emit({ type: "runtime_start", sessionId: this.state.sessionId });
      await this.emit({ type: "turn_start", sessionId: this.state.sessionId });

      const context: Context = {
        systemPrompt: this.systemPrompt,
        messages: convertToLlm(this.state.messages)
      };
      const stream = this.streamSimple(this.model, context, this.streamOptions);
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
      this.state.messages.push(finalMessage);
      await this.emit({
        type: "message_end",
        sessionId: this.state.sessionId,
        message: finalMessage
      });
      await this.emit({
        type: "turn_end",
        sessionId: this.state.sessionId,
        usage: finalMessage.usage,
        stopReason: finalMessage.stopReason
      });
      await this.emit({
        type: "runtime_end",
        sessionId: this.state.sessionId,
        error: this.state.lastError
      });
      this.state.status = this.state.lastError ? "error" : "idle";
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
      if (this.state.status === "running") {
        this.state.status = "idle";
      }
    }
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

function toMessages(input: string | ScorelMessage | ScorelMessage[]): ScorelMessage[] {
  if (typeof input === "string") {
    return [{ role: "user", content: input, timestamp: Date.now() }];
  }
  return Array.isArray(input) ? input : [input];
}
