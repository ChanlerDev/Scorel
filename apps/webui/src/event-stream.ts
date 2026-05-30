import type { ContentBlock, EventId, ScorelEvent, Seq } from "@scorel/protocol";

export type EventStreamRow = {
  id: string;
  kind: "user" | "assistant" | "tool" | "status" | "error";
  title: string;
  text: string;
  seq: Seq;
  status: "streaming" | "final";
};

export type EventStreamProjection = {
  apply(event: ScorelEvent): void;
  getRows(): EventStreamRow[];
};

export const createEventStreamProjection = (): EventStreamProjection => {
  const rows = new Map<string, EventStreamRow>();

  const setRow = (row: EventStreamRow): void => {
    rows.set(row.id, row);
  };

  return {
    apply: (event) => {
      switch (event.type) {
        case "user_message":
          setRow({
            id: event.id,
            kind: "user",
            title: "User",
            text: contentText(event.message.content),
            seq: event.seq,
            status: "final",
          });
          break;
        case "assistant_message":
          setRow({
            id: event.id,
            kind: "assistant",
            title: "Assistant",
            text: contentText(event.message.content),
            seq: event.seq,
            status: "final",
          });
          break;
        case "tool_result": {
          const tool = event.message.content.find((block) => block.type === "tool_result");
          setRow({
            id: event.id,
            kind: "tool",
            title: tool?.type === "tool_result" ? tool.toolName : "Tool result",
            text: contentText(event.message.content),
            seq: event.seq,
            status: "final",
          });
          break;
        }
        case "text_delta": {
          const id = String(event.eventId);
          const existing = rows.get(id);
          setRow({
            id,
            kind: "assistant",
            title: "Assistant",
            text: `${existing?.text ?? ""}${event.delta}`,
            seq: event.seq,
            status: "streaming",
          });
          break;
        }
        case "turn_start":
          setRow(statusRow(`turn_start_${event.seq}`, `Turn ${event.turnIndex} started`, event.seq));
          break;
        case "turn_end":
          setRow(statusRow(`turn_end_${event.seq}`, `Turn ${event.turnIndex} ended: ${event.stopReason ?? "unknown"}`, event.seq));
          break;
        case "error":
          setRow({
            id: `error_${event.seq}`,
            kind: "error",
            title: event.code,
            text: event.message,
            seq: event.seq,
            status: "final",
          });
          break;
        case "message_start":
        case "message_end":
        case "session_header":
          break;
      }
    },
    getRows: () => [...rows.values()].sort((left, right) => Number(left.seq) - Number(right.seq)),
  };
};

export const renderEventStreamRows = (rows: EventStreamRow[]): string => {
  if (rows.length === 0) {
    return `
      <article class="event-card">
        <p class="event-kicker">Session stream</p>
        <h3>Ready for daemon events</h3>
        <p>User messages, assistant output, tool calls, and status events will appear here in the same shared session observed by CLI attach.</p>
      </article>
    `;
  }

  return rows
    .map(
      (row) => `
        <article class="event-card event-card-${row.kind}" data-event-row data-event-id="${escapeHtml(row.id)}">
          <p class="event-kicker">${escapeHtml(row.title)} · seq ${escapeHtml(String(row.seq))}${row.status === "streaming" ? " · streaming" : ""}</p>
          <h3>${escapeHtml(row.kind === "assistant" ? "Assistant" : row.title)}</h3>
          <p>${escapeHtml(row.text)}</p>
        </article>
      `,
    )
    .join("");
};

const statusRow = (id: string, text: string, seq: Seq): EventStreamRow => ({
  id,
  kind: "status",
  title: "Status",
  text,
  seq,
  status: "final",
});

const contentText = (blocks: ContentBlock[]): string =>
  blocks
    .map((block) => {
      switch (block.type) {
        case "text":
        case "thinking":
          return block.text;
        case "tool_call":
          return `${block.toolName} ${JSON.stringify(block.args)}`;
        case "tool_result":
          return typeof block.result === "string" ? block.result : JSON.stringify(block.result);
      }
    })
    .join("");

const escapeHtml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
