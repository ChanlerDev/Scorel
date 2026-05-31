import type {
  EventId,
  PersistentEvent,
  ScorelEvent,
  StopReason,
} from "@scorel/protocol";

/**
 * Pure event projector. Reduces a stream of `ScorelEvent`s into a list of UI
 * turns the chatbox can render. Modeled on the CLI's `AttachEventRenderer`
 * (see `apps/cli/src/index.ts`) but restructured for a structured DOM
 * renderer rather than a TTY printer.
 *
 * Behavior summary:
 * - Persistent `user_message`        → push a user turn with text + tool-call parts.
 * - Persistent `assistant_message`   → upsert assistant turn keyed by event id;
 *                                      replace text from `message.content`,
 *                                      mark `streaming=false`, capture stopReason.
 *                                      If matches `inFlightAssistantId`, replace the in-flight streamed turn.
 * - Persistent `tool_result`         → append a tool_result part to the most recent assistant turn whose
 *                                      tool_call's id matches; if no match, push a standalone tool turn.
 * - Transient `message_start`        → start an assistant turn with empty text, streaming=true.
 * - Transient `text_delta`           → append delta to the in-flight assistant turn's first text part.
 * - Transient `message_end`          → mark assistant turn streaming=false.
 * - Transient `turn_end`             → no projector mutation (assistant_message carries stopReason).
 * - Transient `turn_start`           → no-op.
 * - Transient `error`                → append an error part to the latest turn (or push a synthetic one).
 *
 * Idempotency: events whose `seq` is already incorporated are skipped.
 */

export type TurnPart =
  | { kind: "text"; text: string }
  // Assistant `thinking` reasoning trail. Persistent only — the wire protocol
  // does not stream incremental thinking deltas, so this part only appears
  // after the final `assistant_message` lands. See S0041.
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
      /** Set on locally-issued user turns before the daemon has echoed them back. */
      pending?: boolean;
    }
  | {
      id: string;
      kind: "assistant";
      parts: TurnPart[];
      streaming: boolean;
      stopReason?: StopReason;
    }
  | { id: string; kind: "tool"; parts: TurnPart[] };

export type ProjectorState = {
  turns: Turn[];
  /** Set of event seq numbers already projected. Used for idempotency. */
  appliedSeqs: Set<number>;
  /**
   * The eventId of the assistant message currently streaming (came from a
   * `message_start{role:"assistant"}` transient). Cleared once the
   * corresponding persistent `assistant_message` is upserted, or when a
   * `message_end` for that id is observed.
   */
  inFlightAssistantId?: string;
};

export function emptyProjectorState(): ProjectorState {
  return {
    turns: [],
    appliedSeqs: new Set(),
  };
}

/**
 * Apply a single event. Returns a new state object (the input is treated as
 * immutable from the caller's perspective). The internal collections are
 * shallow-cloned only when necessary to keep the cost per event bounded.
 */
export function projectEvent(state: ProjectorState, event: ScorelEvent): ProjectorState {
  const seq = Number(event.seq);
  if (state.appliedSeqs.has(seq)) {
    return state;
  }
  const next: ProjectorState = {
    turns: state.turns,
    appliedSeqs: new Set(state.appliedSeqs).add(seq),
    inFlightAssistantId: state.inFlightAssistantId,
  };
  switch (event.type) {
    case "session_header":
      // No UI projection — header is metadata only.
      return next;
    case "user_message":
      return appendUserTurn(next, event);
    case "assistant_message":
      return upsertAssistantPersistent(next, event);
    case "tool_result":
      return appendToolResult(next, event);
    case "message_start":
      if (event.role !== "assistant") return next;
      return startInFlightAssistant(next, String(event.eventId));
    case "text_delta":
      return appendTextDelta(next, String(event.eventId), event.delta);
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
  | { type: "text"; text: string }
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
      parts.push({ kind: "text", text: block.text });
    } else if (block.type === "thinking") {
      // Thinking blocks ride on the persistent assistant_message only — there
      // is no transient `thinking_delta` on the wire today, so streaming
      // text_delta paths never produce a thinking part. The UI folds these
      // into a collapsed <details> by default (S0041).
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
  // If there is an existing pending placeholder user turn that mirrors this
  // text, upsert it in-place so the optimistic turn smoothly becomes the
  // authoritative one.
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
    // Already projected via id — keep the projector idempotent in case a
    // tool_result lands twice (resync overlap).
    return state;
  }
  const blocks = event.message.content as ContentBlock[];
  const resultBlocks = blocks.filter((b): b is Extract<ContentBlock, { type: "tool_result" }> =>
    b.type === "tool_result",
  );
  // Try to attach to the assistant turn that issued the matching tool_call.
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
  // No matching assistant turn — render as a standalone tool turn.
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

function startInFlightAssistant(
  state: ProjectorState,
  eventId: string,
): ProjectorState {
  // If a turn for this id already exists (e.g. resync replay), don't double-add.
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
  let turns = state.turns;
  const idx = turns.findIndex((t) => t.id === eventId);
  if (idx < 0) {
    // No matching message_start was observed — synthesize an assistant turn.
    const turn: Turn = {
      id: eventId,
      kind: "assistant",
      parts: [{ kind: "text", text: delta }],
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
  const textIdx = parts.findIndex((p) => p.kind === "text");
  if (textIdx >= 0) {
    const existing = parts[textIdx] as Extract<TurnPart, { kind: "text" }>;
    parts[textIdx] = { kind: "text", text: existing.text + delta };
  } else {
    parts.unshift({ kind: "text", text: delta });
  }
  const merged: Turn = { ...current, parts, streaming: true };
  turns = [...turns];
  turns[idx] = merged;
  return { ...state, turns, inFlightAssistantId: eventId };
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
    return state; // Nothing to attach to — skip silently.
  }
  const turns = [...state.turns];
  const latest = turns[turns.length - 1]!;
  const part: TurnPart = code
    ? { kind: "error", message, code }
    : { kind: "error", message };
  const merged: Turn = { ...latest, parts: [...latest.parts, part] };
  turns[turns.length - 1] = merged;
  return { ...state, turns };
}

/**
 * Synthesize a placeholder user turn for an optimistic local send. The
 * placeholder is replaced by the daemon's persistent user_message echo.
 */
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

/** Find the in-flight assistant id for tests. */
export function getInFlightAssistantId(state: ProjectorState): EventId | undefined {
  return state.inFlightAssistantId as EventId | undefined;
}
