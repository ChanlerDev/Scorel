import type {
  EventId,
  PersistentEvent,
  QueueItem,
  QueueName,
  ScorelEvent,
  StopReason,
} from "@scorel/protocol";

/**
 * Pure event projector. Reduces a stream of `ScorelEvent`s into a list of UI
 * turns the chatbox can render. Independent copy from
 * `apps/webui/lib/events/projector.ts` (S0069).
 */

export type TurnPart =
  | { kind: "text"; text: string }
  | { kind: "thinking"; text: string }
  | { kind: "tool_call"; toolCallId: string; toolName: string; args: unknown }
  | {
      kind: "tool_result";
      toolCallId: string;
      toolName: string;
      result: unknown;
      isError?: boolean;
    }
  | { kind: "error"; message: string; code?: string };

export type Turn =
  | {
      id: string;
      kind: "user";
      parts: TurnPart[];
      pending?: boolean;
    }
  | {
      id: string;
      kind: "assistant";
      parts: TurnPart[];
      streaming: boolean;
      stopReason?: StopReason;
    }
  | { id: string; kind: "tool"; parts: TurnPart[] }
  | { id: string; kind: "harness"; label: string; parts: Extract<TurnPart, { kind: "text" }>[] };

export type QueuePreviewItem = QueueItem & {
  queue: QueueName;
  text: string;
};

export type ProjectorState = {
  turns: Turn[];
  queues: Record<QueueName, QueuePreviewItem[]>;
  appliedSeqs: Set<number>;
  inFlightAssistantId?: string;
};

export function emptyProjectorState(): ProjectorState {
  return {
    turns: [],
    queues: { follow_up: [], steer: [] },
    appliedSeqs: new Set(),
  };
}

export function projectEvent(state: ProjectorState, event: ScorelEvent): ProjectorState {
  const seq = Number(event.seq);
  if (state.appliedSeqs.has(seq)) {
    return state;
  }
  const next: ProjectorState = {
    turns: state.turns,
    queues: state.queues,
    appliedSeqs: new Set(state.appliedSeqs).add(seq),
    inFlightAssistantId: state.inFlightAssistantId,
  };
  switch (event.type) {
    case "session_header":
    case "session_title_updated":
      return next;
    case "user_message":
      return appendUserTurn(next, event);
    case "assistant_message":
      return upsertAssistantPersistent(next, event);
    case "tool_result":
      return appendToolResult(next, event);
    case "harness_item":
      return appendHarnessItem(next, event);
    case "queue_update":
      return updateQueue(next, event);
    case "message_start":
      if (event.role !== "assistant") return next;
      return startInFlightAssistant(next, String(event.eventId));
    case "text_delta":
      return appendTextDelta(next, String(event.eventId), event.delta);
    case "thinking_delta":
      return appendThinkingDelta(next, String(event.eventId), event.delta);
    case "message_end":
      return endInFlightAssistant(next, String(event.eventId), event.stopReason);
    case "turn_start":
    case "turn_end":
      return next;
    case "error":
      return appendError(next, event.message, event.code);
    default:
      return next;
  }
}

export function projectEvents(initial: ProjectorState, events: ScorelEvent[]): ProjectorState {
  let state = initial;
  for (const event of events) {
    state = projectEvent(state, event);
  }
  return state;
}

// --- helpers ---------------------------------------------------------------

type ContentBlock =
  | { type: "text"; text: string; visibility?: "display" | "model" }
  | { type: "thinking"; text: string }
  | { type: "tool_call"; toolCallId: string; toolName: string; args: unknown }
  | {
      type: "tool_result";
      toolCallId: string;
      toolName: string;
      result: unknown;
      isError?: boolean;
    };

function blocksToParts(blocks: ContentBlock[]): TurnPart[] {
  const parts: TurnPart[] = [];
  for (const block of blocks) {
    if (block.type === "text") {
      if (block.visibility === "model") continue;
      parts.push({ kind: "text", text: block.text });
    } else if (block.type === "thinking") {
      parts.push({ kind: "thinking", text: block.text });
    } else if (block.type === "tool_call") {
      parts.push({
        kind: "tool_call",
        toolCallId: block.toolCallId,
        toolName: block.toolName,
        args: block.args,
      });
    } else if (block.type === "tool_result") {
      parts.push({
        kind: "tool_result",
        toolCallId: block.toolCallId,
        toolName: block.toolName,
        result: block.result,
        ...(block.isError ? { isError: true } : {}),
      });
    }
  }
  return parts;
}

function appendUserTurn(
  state: ProjectorState,
  event: Extract<PersistentEvent, { type: "user_message" }>,
): ProjectorState {
  const id = String(event.id);
  const placeholderIdx = state.turns.findIndex(
    (turn) => turn.kind === "user" && turn.pending,
  );
  const parts = blocksToParts(event.message.content as ContentBlock[]);
  const turn: Turn = { id, kind: "user", parts };
  let turns: Turn[];
  if (placeholderIdx >= 0) {
    turns = [...state.turns];
    turns[placeholderIdx] = turn;
  } else if (state.turns.some((t) => t.id === id)) {
    turns = state.turns.map((t) => (t.id === id ? turn : t));
  } else {
    turns = [...state.turns, turn];
  }
  return { ...state, turns };
}

function upsertAssistantPersistent(
  state: ProjectorState,
  event: Extract<PersistentEvent, { type: "assistant_message" }>,
): ProjectorState {
  const id = String(event.id);
  const parts = blocksToParts(event.message.content as ContentBlock[]);
  const turn: Turn = {
    id,
    kind: "assistant",
    parts,
    streaming: false,
    ...(event.message.stopReason ? { stopReason: event.message.stopReason } : {}),
  };

  const existingIdx = state.turns.findIndex((t) => t.id === id);
  let turns: Turn[];
  if (existingIdx >= 0) {
    turns = [...state.turns];
    turns[existingIdx] = turn;
  } else {
    turns = [...state.turns, turn];
  }
  return {
    ...state,
    turns,
    inFlightAssistantId:
      state.inFlightAssistantId === id ? undefined : state.inFlightAssistantId,
  };
}

function appendToolResult(
  state: ProjectorState,
  event: Extract<PersistentEvent, { type: "tool_result" }>,
): ProjectorState {
  const id = String(event.id);
  if (state.turns.some((t) => t.id === id)) {
    return state;
  }
  const blocks = event.message.content as ContentBlock[];
  const resultBlocks = blocks.filter((b): b is Extract<ContentBlock, { type: "tool_result" }> =>
    b.type === "tool_result",
  );
  for (let i = state.turns.length - 1; i >= 0; i -= 1) {
    const candidate = state.turns[i];
    if (!candidate || candidate.kind !== "assistant") continue;
    const hasMatchingCall = candidate.parts.some(
      (part) =>
        part.kind === "tool_call" &&
        resultBlocks.some((rb) => rb.toolCallId === part.toolCallId),
    );
    if (!hasMatchingCall) continue;
    const merged: Turn = {
      ...candidate,
      parts: [
        ...candidate.parts,
        ...resultBlocks.map<TurnPart>((rb) => ({
          kind: "tool_result",
          toolCallId: rb.toolCallId,
          toolName: rb.toolName,
          result: rb.result,
          ...(rb.isError ? { isError: true } : {}),
        })),
      ],
    };
    const turns = [...state.turns];
    turns[i] = merged;
    return { ...state, turns };
  }
  const standalone: Turn = {
    id,
    kind: "tool",
    parts: resultBlocks.map<TurnPart>((rb) => ({
      kind: "tool_result",
      toolCallId: rb.toolCallId,
      toolName: rb.toolName,
      result: rb.result,
      ...(rb.isError ? { isError: true } : {}),
    })),
  };
  return { ...state, turns: [...state.turns, standalone] };
}

function appendHarnessItem(
  state: ProjectorState,
  event: Extract<PersistentEvent, { type: "harness_item" }>,
): ProjectorState {
  if (event.item.visibility === "hidden") {
    return state;
  }
  if (state.turns.some((turn) => turn.id === String(event.id))) {
    return state;
  }
  const label = event.item.kind === "steer" && event.item.origin === "user" ? "Steer" : "Harness";
  return {
    ...state,
    turns: [
      ...state.turns,
      {
        id: String(event.id),
        kind: "harness",
        label,
        parts: [{ kind: "text", text: event.item.content }],
      },
    ],
  };
}

function updateQueue(
  state: ProjectorState,
  event: Extract<PersistentEvent, { type: "queue_update" }>,
): ProjectorState {
  return {
    ...state,
    queues: {
      ...state.queues,
      [event.queue]: event.items.map((item) => ({
        ...item,
        queue: event.queue,
        text: textFromContent(item.content as ContentBlock[]),
      })),
    },
  };
}

function startInFlightAssistant(
  state: ProjectorState,
  eventId: string,
): ProjectorState {
  if (state.turns.some((t) => t.id === eventId)) {
    return { ...state, inFlightAssistantId: eventId };
  }
  const turn: Turn = {
    id: eventId,
    kind: "assistant",
    parts: [{ kind: "text", text: "" }],
    streaming: true,
  };
  return {
    ...state,
    turns: [...state.turns, turn],
    inFlightAssistantId: eventId,
  };
}

function appendTextDelta(
  state: ProjectorState,
  eventId: string,
  delta: string,
): ProjectorState {
  return appendAssistantPartDelta(state, eventId, "text", delta);
}

function appendThinkingDelta(
  state: ProjectorState,
  eventId: string,
  delta: string,
): ProjectorState {
  return appendAssistantPartDelta(state, eventId, "thinking", delta);
}

function appendAssistantPartDelta(
  state: ProjectorState,
  eventId: string,
  kind: "text" | "thinking",
  delta: string,
): ProjectorState {
  let turns = state.turns;
  const idx = turns.findIndex((t) => t.id === eventId);
  if (idx < 0) {
    const turn: Turn = {
      id: eventId,
      kind: "assistant",
      parts: [{ kind, text: delta }],
      streaming: true,
    };
    return {
      ...state,
      turns: [...turns, turn],
      inFlightAssistantId: eventId,
    };
  }
  const current = turns[idx]!;
  if (current.kind !== "assistant") return state;
  const parts = [...current.parts];
  const partIdx = parts.findIndex((p) => p.kind === kind);
  if (partIdx >= 0) {
    const existing = parts[partIdx] as Extract<TurnPart, { kind: "text" | "thinking" }>;
    parts[partIdx] = { kind, text: existing.text + delta };
  } else {
    const insertAt = kind === "thinking" ? 0 : lastThinkingIndex(parts) + 1;
    parts.splice(insertAt, 0, { kind, text: delta });
  }
  const merged: Turn = { ...current, parts, streaming: true };
  turns = [...turns];
  turns[idx] = merged;
  return { ...state, turns, inFlightAssistantId: eventId };
}

function lastThinkingIndex(parts: TurnPart[]): number {
  for (let i = parts.length - 1; i >= 0; i -= 1) {
    if (parts[i]?.kind === "thinking") return i;
  }
  return -1;
}

function endInFlightAssistant(
  state: ProjectorState,
  eventId: string,
  stopReason?: StopReason,
): ProjectorState {
  const idx = state.turns.findIndex((t) => t.id === eventId);
  if (idx < 0) {
    return {
      ...state,
      inFlightAssistantId:
        state.inFlightAssistantId === eventId ? undefined : state.inFlightAssistantId,
    };
  }
  const current = state.turns[idx]!;
  if (current.kind !== "assistant") return state;
  const merged: Turn = {
    ...current,
    streaming: false,
    ...(stopReason ? { stopReason } : {}),
  };
  const turns = [...state.turns];
  turns[idx] = merged;
  return {
    ...state,
    turns,
    inFlightAssistantId:
      state.inFlightAssistantId === eventId ? undefined : state.inFlightAssistantId,
  };
}

function appendError(state: ProjectorState, message: string, code?: string): ProjectorState {
  if (state.turns.length === 0) {
    return state;
  }
  const turns = [...state.turns];
  const latest = turns[turns.length - 1]!;
  if (latest.kind === "harness") {
    return state;
  }
  const part: TurnPart = code
    ? { kind: "error", message, code }
    : { kind: "error", message };
  const merged: Turn = { ...latest, parts: [...latest.parts, part] };
  turns[turns.length - 1] = merged;
  return { ...state, turns };
}

export function appendPendingUserTurn(
  state: ProjectorState,
  placeholder: { id: string; text: string },
): ProjectorState {
  const turn: Turn = {
    id: placeholder.id,
    kind: "user",
    parts: [{ kind: "text", text: placeholder.text }],
    pending: true,
  };
  return { ...state, turns: [...state.turns, turn] };
}

export function getInFlightAssistantId(state: ProjectorState): EventId | undefined {
  return state.inFlightAssistantId as EventId | undefined;
}

function textFromContent(blocks: ContentBlock[]): string {
  return blocks
    .filter((block): block is Extract<ContentBlock, { type: "text" }> => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}
