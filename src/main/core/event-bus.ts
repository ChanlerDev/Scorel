import { EventEmitter } from "node:events";
import type { ScorelEvent } from "../../shared/events.js";
import type { AssistantMessageEvent } from "../../shared/events.js";

export class EventBus extends EventEmitter {
  emitAppEvent(event: ScorelEvent): boolean {
    return super.emit("scorel-event", event);
  }

  onAppEvent(listener: (event: ScorelEvent) => void): this {
    return super.on("scorel-event", listener);
  }

  offAppEvent(listener: (event: ScorelEvent) => void): this {
    return super.off("scorel-event", listener);
  }

  emitStreamEvent(sessionId: string, event: AssistantMessageEvent): boolean {
    return super.emit(`stream:${sessionId}`, event);
  }

  onStreamEvent(sessionId: string, listener: (event: AssistantMessageEvent) => void): this {
    return super.on(`stream:${sessionId}`, listener);
  }

  offStreamEvent(sessionId: string, listener: (event: AssistantMessageEvent) => void): this {
    return super.off(`stream:${sessionId}`, listener);
  }
}
