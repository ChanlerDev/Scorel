import {
  ScorelRuntime,
  buildContext,
  corePackageName,
  createCodingTools,
  createSession,
  defineTool,
  loadSession,
  type JsonlSession,
  type RawRuntimeEvent,
  type RuntimeProvider,
  type ToolResult,
} from "@scorel/core";
import {
  asClientId,
  asEventId,
  asSeq,
  asSessionId,
  protocolPackageName,
  protocolVersion,
  type ClientId,
  type ClientMessage,
  type ClientRequest,
  type DaemonTransport,
  type DaemonMessage,
  type DeviceId,
  type EventId,
  type PersistentEvent,
  type ScorelEvent,
  type Seq,
  type SessionId,
  type SessionMeta,
  type ScorelMessage,
  type TransientEvent,
  type Unsubscribe,
} from "@scorel/protocol";

export const daemonPackageName = "@scorel/daemon" as const;
export const daemonCoreDependency = corePackageName;
export const daemonProtocolDependency = protocolPackageName;
export const daemonProtocolVersion = protocolVersion;
export type EmbeddedDaemonTransport = DaemonTransport;

export type EmbeddedDaemonOptions = {
  sessionsDir: string;
  deviceId: DeviceId;
  createRuntime: (sessionId: SessionId) => ScorelRuntime;
  now?: () => number;
  createId?: () => string;
};

export const createM1FakeRuntime = (options: { cwd?: string } = {}): ScorelRuntime => {
  const runtime = new ScorelRuntime({ provider: createM1FakeProvider() });
  for (const tool of createCodingTools({ cwd: options.cwd ?? process.cwd() })) {
    runtime.registerTool(tool);
  }
  runtime.registerTool(
    defineTool({
      name: "echo",
      description: "Echo input text for CLI Alpha verification",
      execute: async (_toolCallId, args): Promise<ToolResult> => ({
        content: [{ type: "text", text: String((args as { text?: unknown }).text ?? "") }],
      }),
    }),
  );
  return runtime;
};

const createM1FakeProvider = (): RuntimeProvider => ({
  streamTurn: async function* ({ context }) {
    const toolResult = lastToolResultText(context);
    if (toolResult !== undefined) {
      const text = `Tool: ${toolResult}`;
      yield { type: "text_delta", delta: text };
      return assistantText(text);
    }

    const input = lastUserText(context);
    const codingToolCall = parseFakeCodingToolCall(input);
    if (codingToolCall) {
      return {
        role: "assistant",
        content: [{ type: "tool_call", ...codingToolCall }],
        stopReason: "tool_call",
      };
    }

    if (input.startsWith("/echo ")) {
      return {
        role: "assistant",
        content: [
          {
            type: "tool_call",
            toolCallId: "call_echo",
            toolName: "echo",
            args: { text: input.slice("/echo ".length) },
          },
        ],
        stopReason: "tool_call",
      };
    }

    const text = `Echo: ${input}`;
    yield { type: "text_delta", delta: text };
    return assistantText(text);
  },
});

const parseFakeCodingToolCall = (
  input: string,
): { toolCallId: string; toolName: string; args: Record<string, unknown> } | undefined => {
  if (input.startsWith("/read ")) {
    return {
      toolCallId: "call_read",
      toolName: "Read",
      args: { path: input.slice("/read ".length).trim() },
    };
  }
  if (input.startsWith("/write ")) {
    const [path, ...contentParts] = input.slice("/write ".length).trim().split(/\s+/);
    if (!path) {
      return undefined;
    }
    return {
      toolCallId: "call_write",
      toolName: "Write",
      args: { path, content: contentParts.join(" ") },
    };
  }
  if (input.startsWith("/edit ")) {
    const [path, oldString, newString] = input.slice("/edit ".length).trim().split(/\s+/);
    if (!path || oldString === undefined || newString === undefined) {
      return undefined;
    }
    return {
      toolCallId: "call_edit",
      toolName: "Edit",
      args: { path, old_string: oldString, new_string: newString },
    };
  }
  if (input.startsWith("/bash ")) {
    return {
      toolCallId: "call_bash",
      toolName: "Bash",
      args: { command: input.slice("/bash ".length).trim() },
    };
  }
  if (input.startsWith("/glob ")) {
    return {
      toolCallId: "call_glob",
      toolName: "Glob",
      args: { pattern: input.slice("/glob ".length).trim() },
    };
  }
  if (input.startsWith("/grep ")) {
    const [pattern, glob] = input.slice("/grep ".length).trim().split(/\s+/);
    if (!pattern) {
      return undefined;
    }
    return {
      toolCallId: "call_grep",
      toolName: "Grep",
      args: { pattern, glob, outputMode: "content" },
    };
  }
  if (input.startsWith("/todo ")) {
    return {
      toolCallId: "call_todo",
      toolName: "Todo",
      args: { todos: parseFakeTodos(input.slice("/todo ".length).trim()) },
    };
  }
  return undefined;
};

const parseFakeTodos = (input: string): Array<{ id: string; status: string; content: string }> =>
  input
    .split("|")
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .map((item) => {
      const [id, status, ...contentParts] = item.split(":");
      return {
        id: id ?? "",
        status: status ?? "pending",
        content: contentParts.join(":"),
      };
    });

const assistantText = (text: string): ScorelMessage & { role: "assistant" } => ({
  role: "assistant",
  content: [{ type: "text", text }],
  stopReason: "end_turn",
});

const lastUserText = (context: ScorelMessage[]): string => {
  const user = findLast(context, (message) => message.role === "user");
  return user?.content.find((block) => block.type === "text")?.text ?? "";
};

const lastToolResultText = (context: ScorelMessage[]): string | undefined => {
  const toolResult = context.at(-1)?.role === "tool_result" ? context.at(-1) : undefined;
  const block = toolResult?.content.find((candidate) => candidate.type === "tool_result");
  if (!block || typeof block.result !== "object" || block.result === null) {
    return undefined;
  }
  const result = block.result as { content?: Array<{ type: string; text?: string }> };
  return result.content?.find((candidate) => candidate.type === "text")?.text;
};

const findLast = <TValue>(values: TValue[], predicate: (value: TValue) => boolean): TValue | undefined => {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    const value = values[index];
    if (value !== undefined && predicate(value)) {
      return value;
    }
  }
  return undefined;
};

type SessionLane = {
  session: JsonlSession;
  runtime: ScorelRuntime;
  queue: Promise<unknown>;
};

type PersistentEventInput =
  | Omit<Extract<PersistentEvent, { type: "user_message" }>, "seq">
  | Omit<Extract<PersistentEvent, { type: "assistant_message" }>, "seq">
  | Omit<Extract<PersistentEvent, { type: "tool_result" }>, "seq">;

type TransientEventInput =
  | Omit<Extract<TransientEvent, { type: "turn_start" }>, "seq">
  | Omit<Extract<TransientEvent, { type: "turn_end" }>, "seq">
  | Omit<Extract<TransientEvent, { type: "message_start" }>, "seq">
  | Omit<Extract<TransientEvent, { type: "text_delta" }>, "seq">
  | Omit<Extract<TransientEvent, { type: "error" }>, "seq">;

type Connection = {
  clientId: ClientId;
  sessionId?: SessionId;
  emit: (message: DaemonMessage) => void;
};

type RuntimeEventState = {
  parentId: EventId;
  assistantEventId: EventId;
  finalAssistantEventId: EventId;
};

export class EmbeddedDaemon {
  readonly #sessionsDir: string;
  readonly #deviceId: DeviceId;
  readonly #createRuntime: (sessionId: SessionId) => ScorelRuntime;
  readonly #now: () => number;
  readonly #createId: () => string;
  readonly #sessions = new Map<SessionId, SessionLane>();
  readonly #connections = new Set<Connection>();
  readonly #events = new Map<SessionId, ScorelEvent[]>();
  readonly #seqs = new Map<SessionId, number>();
  #started = false;

  constructor(options: EmbeddedDaemonOptions) {
    this.#sessionsDir = options.sessionsDir;
    this.#deviceId = options.deviceId;
    this.#createRuntime = options.createRuntime;
    this.#now = options.now ?? Date.now;
    this.#createId = options.createId ?? (() => crypto.randomUUID());
  }

  async start(): Promise<void> {
    this.#started = true;
  }

  async shutdown(): Promise<void> {
    this.#connections.clear();
    this.#started = false;
  }

  connect(connection: Connection, sessionId?: SessionId): { currentSeq: Seq; sessionId?: SessionId } {
    this.#assertStarted();
    connection.sessionId = sessionId;
    this.#connections.add(connection);
    return {
      sessionId,
      currentSeq: asSeq(sessionId ? (this.#seqs.get(sessionId) ?? 0) : 0),
    };
  }

  disconnect(connection: Connection): void {
    this.#connections.delete(connection);
  }

  async handleMessage(connection: Connection, message: ClientMessage): Promise<void> {
    this.#assertStarted();
    switch (message.type) {
      case "create_session":
        await this.#handleCreateSession(connection, message);
        break;
      case "load_session":
        await this.#handleLoadSession(connection, message);
        break;
      case "send_message":
        await this.#handleSendMessage(connection, message);
        break;
      case "resync_events":
        this.#respond(connection, message, {
          events: this.#eventsAfter(message.sessionId, message.fromSeq),
          throughSeq: asSeq(this.#seqs.get(message.sessionId) ?? 0),
        });
        break;
      case "get_status":
        this.#respond(connection, message, {
          running: false,
          activeClients: [...this.#connections].map((candidate) => candidate.clientId),
          sessionCount: this.#sessions.size,
          uptimeMs: 0,
        });
        break;
      case "ping":
        connection.emit({ type: "pong", requestId: message.requestId });
        break;
      case "disconnect":
        this.disconnect(connection);
        break;
      case "list_sessions":
      case "subscribe_events":
        connection.emit({
          type: "error",
          requestId: message.requestId,
          ok: false,
          code: "invalid_request",
          message: `${message.type} is not implemented in embedded M1`,
        });
        break;
    }
  }

  async #handleCreateSession(connection: Connection, request: ClientRequest<"create_session">): Promise<void> {
    const sessionId = request.sessionId ?? asSessionId(`ses_${this.#createId()}`);
    const lane = await this.#createLane(sessionId, request.meta ?? {});
    this.#sessions.set(sessionId, lane);
    this.#events.set(sessionId, []);
    this.#seqs.set(sessionId, 0);
    this.#respond(connection, request, { sessionId });
  }

  async #handleLoadSession(connection: Connection, request: ClientRequest<"load_session">): Promise<void> {
    try {
      const lane = await this.#getLane(request.sessionId);
      connection.sessionId = request.sessionId;
      const persistentEvents = [...lane.session.tree];
      const sessionEvents = this.#events.get(request.sessionId) ?? [];
      if (sessionEvents.length === 0 && persistentEvents.length > 0) {
        this.#events.set(request.sessionId, persistentEvents);
      }
      this.#respond(connection, request, {
        sessionId: request.sessionId,
        activeLeafId: lane.session.activeLeafId,
        currentSeq: lane.session.currentSeq,
        events: persistentEvents,
        meta: lane.session.header.meta,
      });
    } catch (cause) {
      connection.emit({
        type: "error",
        requestId: request.requestId,
        ok: false,
        code: "session_not_found",
        message: cause instanceof Error ? cause.message : String(cause),
      });
    }
  }

  async #handleSendMessage(connection: Connection, request: ClientRequest<"send_message">): Promise<void> {
    const lane = await this.#getLane(request.sessionId);
    lane.queue = lane.queue.then(async () => {
      const userEventId = asEventId(this.#createId());
      const content = typeof request.content === "string" ? [{ type: "text" as const, text: request.content }] : request.content;
      const userEvent = await this.#appendPersistent(lane, {
        type: "user_message",
        id: userEventId,
        parentId: request.options?.parentId ?? lane.session.activeLeafId,
        sessionId: request.sessionId,
        clientId: connection.clientId,
        ts: this.#now(),
        message: { role: "user", content },
      });
      const firstAssistantEventId = asEventId(this.#createId());
      const state: RuntimeEventState = {
        parentId: userEvent.id,
        assistantEventId: firstAssistantEventId,
        finalAssistantEventId: firstAssistantEventId,
      };

      for await (const rawEvent of lane.runtime.executeTurn(buildContext(lane.session.tree, userEvent.id), undefined, {})) {
        await this.#handleRuntimeEvent(lane, connection.clientId, state, rawEvent);
      }

      this.#respond(connection, request, { userEventId, assistantEventId: state.finalAssistantEventId });
    });

    await lane.queue;
  }

  async #handleRuntimeEvent(
    lane: SessionLane,
    clientId: ClientId,
    state: RuntimeEventState,
    rawEvent: RawRuntimeEvent,
  ): Promise<void> {
    switch (rawEvent.type) {
      case "turn_start":
        this.#broadcastTransient(lane.session.header.sessionId, {
          type: "turn_start",
          sessionId: lane.session.header.sessionId,
          clientId,
          ts: this.#now(),
          turnIndex: 0,
        });
        break;
      case "message_start":
        this.#broadcastTransient(lane.session.header.sessionId, {
          type: "message_start",
          sessionId: lane.session.header.sessionId,
          clientId,
          ts: this.#now(),
          eventId: state.assistantEventId,
          parentId: state.parentId,
          role: rawEvent.role,
        });
        break;
      case "text_delta":
        this.#broadcastTransient(lane.session.header.sessionId, {
          type: "text_delta",
          sessionId: lane.session.header.sessionId,
          clientId,
          ts: this.#now(),
          eventId: state.assistantEventId,
          delta: rawEvent.delta,
        });
        break;
      case "message_end": {
        const appended = (
          await this.#appendPersistent(lane, {
            type: "assistant_message",
            id: state.assistantEventId,
            parentId: state.parentId,
            sessionId: lane.session.header.sessionId,
            clientId,
            ts: this.#now(),
            message: rawEvent.message,
          })
        ).id;
        state.parentId = appended;
        state.finalAssistantEventId = appended;
        state.assistantEventId = asEventId(this.#createId());
        break;
      }
      case "tool_execution_start":
        break;
      case "tool_execution_end": {
        const toolResultId = asEventId(this.#createId());
        await this.#appendPersistent(lane, {
          type: "tool_result",
          id: toolResultId,
          parentId: state.parentId,
          sessionId: lane.session.header.sessionId,
          clientId,
          ts: this.#now(),
          message: {
            role: "tool_result",
            content: [
              {
                type: "tool_result",
                toolCallId: rawEvent.toolCallId,
                toolName: rawEvent.toolName,
                result: rawEvent.result,
                isError: rawEvent.isError,
              },
            ],
          },
        });
        state.parentId = toolResultId;
        break;
      }
      case "turn_end":
        this.#broadcastTransient(lane.session.header.sessionId, {
          type: "turn_end",
          sessionId: lane.session.header.sessionId,
          clientId,
          ts: this.#now(),
          turnIndex: 0,
          stopReason: rawEvent.stopReason,
        });
        break;
      case "error":
        this.#broadcastTransient(lane.session.header.sessionId, {
          type: "error",
          sessionId: lane.session.header.sessionId,
          clientId,
          ts: this.#now(),
          code: "internal_error",
          message: rawEvent.error.message,
        });
        break;
    }
  }

  async #appendPersistent(
    lane: SessionLane,
    event: PersistentEventInput,
  ): Promise<PersistentEvent> {
    const withSeq = { ...event, seq: this.#nextSeq(lane.session.header.sessionId) } as PersistentEvent;
    await lane.session.append(withSeq);
    this.#recordAndBroadcast(lane.session.header.sessionId, withSeq);
    return withSeq;
  }

  #broadcastTransient(sessionId: SessionId, event: TransientEventInput): TransientEvent {
    const withSeq = { ...event, seq: this.#nextSeq(sessionId) } as TransientEvent;
    this.#recordAndBroadcast(sessionId, withSeq);
    return withSeq;
  }

  #recordAndBroadcast(sessionId: SessionId, event: ScorelEvent): void {
    const events = this.#events.get(sessionId) ?? [];
    events.push(event);
    this.#events.set(sessionId, events);
    for (const connection of this.#connections) {
      if (connection.sessionId === sessionId) {
        connection.emit({ type: "event", event });
      }
    }
  }

  #nextSeq(sessionId: SessionId): Seq {
    const next = (this.#seqs.get(sessionId) ?? 0) + 1;
    this.#seqs.set(sessionId, next);
    return asSeq(next);
  }

  #eventsAfter(sessionId: SessionId, fromSeq: Seq | undefined): ScorelEvent[] {
    const from = Number(fromSeq ?? 0);
    return (this.#events.get(sessionId) ?? []).filter((event) => Number(event.seq) > from);
  }

  async #getLane(sessionId: SessionId): Promise<SessionLane> {
    const existing = this.#sessions.get(sessionId);
    if (existing) {
      return existing;
    }
    const loaded = await loadSession({ sessionsDir: this.#sessionsDir, sessionId });
    const lane = {
      session: loaded,
      runtime: this.#createRuntime(sessionId),
      queue: Promise.resolve(),
    };
    this.#sessions.set(sessionId, lane);
    this.#seqs.set(sessionId, Number(loaded.currentSeq));
    return lane;
  }

  async #createLane(sessionId: SessionId, meta: Partial<SessionMeta>): Promise<SessionLane> {
    const session = await createSession({
      sessionsDir: this.#sessionsDir,
      header: {
        version: 1,
        sessionId,
        deviceId: this.#deviceId,
        createdAt: this.#now(),
        meta,
      },
    });
    return {
      session,
      runtime: this.#createRuntime(sessionId),
      queue: Promise.resolve(),
    };
  }

  #respond<TRequest extends ClientRequest>(
    connection: Connection,
    request: TRequest,
    data: unknown,
  ): void {
    connection.emit({
      type: "response",
      requestType: request.type,
      requestId: request.requestId,
      ok: true,
      data,
    } as DaemonMessage);
  }

  #assertStarted(): void {
    if (!this.#started) {
      throw new Error("EmbeddedDaemon is not started");
    }
  }
}

export const createEmbeddedTransport = (daemon: EmbeddedDaemon): DaemonTransport => {
  const handlers = new Set<(message: DaemonMessage) => void>();
  const connection: Connection = {
    clientId: asClientId("embedded_unconnected"),
    emit: (message) => {
      for (const handler of handlers) {
        handler(message);
      }
    },
  };

  return {
    async connect(params) {
      connection.clientId = params.clientId;
      const result = daemon.connect(connection, params.sessionId);
      connection.emit({
        type: "connected",
        clientId: params.clientId,
        sessionId: result.sessionId,
        currentSeq: result.currentSeq,
      });
      return {
        clientId: params.clientId,
        sessionId: result.sessionId,
        currentSeq: result.currentSeq,
      };
    },
    send(message) {
      return daemon.handleMessage(connection, message);
    },
    onMessage(handler) {
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
      };
    },
    close() {
      daemon.disconnect(connection);
      handlers.clear();
    },
  };
};
