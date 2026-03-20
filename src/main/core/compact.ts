import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type Database from "better-sqlite3";
import {
  MANUAL_COMPACT_MAX_INPUT,
  MANUAL_COMPACT_TOOL_RESULT_PREVIEW,
  MICRO_COMPACT_KEEP_RECENT,
} from "../../shared/constants.js";
import type {
  AssistantMessage,
  CompactionRecord,
  ManualCompactResult,
  ProviderConfig,
  ScorelMessage,
  ToolResultMessage,
  UserMessage,
} from "../../shared/types.js";
import type { ProviderAdapter } from "../provider/types.js";
import { insertCompaction } from "../storage/compactions.js";
import { generateId } from "./id.js";

const COMPACT_TRANSCRIPT_VERSION = "scorel.compact.v0";

function buildCompactSummaryPrompt(serializedMessages: string): string {
  return `Summarize the following conversation, preserving:
1. Key decisions and their rationale
2. Files that were created or modified (with paths)
3. Current task status and next steps
4. Any unresolved issues or errors

Be concise but complete. This summary will replace the conversation history.

<conversation>
${serializedMessages}
</conversation>`;
}

function getTurnBoundaries(messages: ScorelMessage[]): number[] {
  const boundaries: number[] = [];
  messages.forEach((message, index) => {
    if (message.role === "user") {
      boundaries.push(index);
    }
  });
  return boundaries;
}

function getMessageTurn(index: number, turnBoundaries: number[]): number | null {
  if (turnBoundaries.length === 0) return null;

  let low = 0;
  let high = turnBoundaries.length - 1;
  let result = 0;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (turnBoundaries[mid] <= index) {
      result = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return result;
}

export function applyMicroCompact(
  messages: ScorelMessage[],
  keepRecent = MICRO_COMPACT_KEEP_RECENT,
): ScorelMessage[] {
  const turnBoundaries = getTurnBoundaries(messages);
  if (turnBoundaries.length === 0) {
    return messages;
  }

  const currentTurn = turnBoundaries.length - 1;

  return messages.map((message, index) => {
    if (message.role !== "toolResult") {
      return message;
    }

    const messageTurn = getMessageTurn(index, turnBoundaries);
    if (messageTurn == null || currentTurn - messageTurn <= keepRecent) {
      return message;
    }

    return {
      ...message,
      content: [{ type: "text", text: `[Previous: used ${message.toolName}]` }],
      details: undefined,
    } satisfies ToolResultMessage;
  });
}

function serializeAssistantMessage(message: AssistantMessage): string {
  const parts: string[] = [];
  const text = message.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n");

  if (text.length > 0) {
    parts.push(`[Assistant]\n${text}`);
  }

  for (const part of message.content) {
    if (part.type === "toolCall") {
      parts.push(`[Tool Call: ${part.name}]\n${JSON.stringify(part.arguments, null, 2)}`);
    }
  }

  if (parts.length === 0) {
    return "[Assistant]\n";
  }

  return parts.join("\n\n");
}

function serializeToolResultMessage(message: ToolResultMessage): string {
  const text = message.content.map((part) => part.text).join("\n");
  const preview = text.length > MANUAL_COMPACT_TOOL_RESULT_PREVIEW
    ? `${text.slice(0, MANUAL_COMPACT_TOOL_RESULT_PREVIEW)}... (truncated)`
    : text;

  return `[Tool Result: ${message.toolName}]\n${preview}`;
}

function serializeMessage(message: ScorelMessage): string {
  if (message.role === "user") {
    return `[User]\n${message.content}`;
  }

  if (message.role === "assistant") {
    return serializeAssistantMessage(message);
  }

  return serializeToolResultMessage(message);
}

export function serializeForCompact(messages: ScorelMessage[]): string {
  return messages.map(serializeMessage).join("\n\n");
}

function trimSerializedMessages(messages: ScorelMessage[]): string {
  const segments = messages.map(serializeMessage);
  const kept: string[] = [];
  let total = 0;

  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const segment = segments[index];
    const delta = segment.length + (kept.length > 0 ? 2 : 0);

    if (kept.length > 0 && total + delta > MANUAL_COMPACT_MAX_INPUT) {
      break;
    }

    kept.unshift(segment);
    total += delta;

    if (kept.length === 1 && total > MANUAL_COMPACT_MAX_INPUT) {
      // Keep the newest tail of a single oversized message so the most recent context survives.
      kept[0] = segment.slice(segment.length - MANUAL_COMPACT_MAX_INPUT);
      total = kept[0].length;
      break;
    }
  }

  return kept.join("\n\n");
}

function collectAssistantText(message: AssistantMessage): string {
  return message.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim();
}

export function makeCompactSummaryMessage(compaction: CompactionRecord): UserMessage {
  return {
    role: "user",
    id: `compact-summary-${compaction.id}`,
    content: `[Previous conversation summary]\n\n${compaction.summaryText}\n\n[End of summary. The conversation continues below.]`,
    ts: compaction.createdAt,
  };
}

export function applyBoundaryResume(
  messages: ScorelMessage[],
  compaction: CompactionRecord | null,
): ScorelMessage[] {
  if (!compaction) {
    return messages;
  }

  return [makeCompactSummaryMessage(compaction), ...messages];
}

export async function saveCompactTranscript(
  dir: string,
  sessionId: string,
  compactionId: string,
  messages: ScorelMessage[],
): Promise<string> {
  await mkdir(dir, { recursive: true });
  const filePath = path.join(dir, `${sessionId}-${compactionId}.jsonl`);
  const lines = [
    JSON.stringify({
      v: COMPACT_TRANSCRIPT_VERSION,
      type: "compaction",
      compactionId,
      sessionId,
      ts: Date.now(),
    }),
    ...messages.map((message, index) => JSON.stringify({
      v: COMPACT_TRANSCRIPT_VERSION,
      type: "message",
      seq: index + 1,
      message,
    })),
  ];

  await writeFile(filePath, `${lines.join("\n")}\n`, "utf8");
  return filePath;
}

export async function executeManualCompact(opts: {
  sessionId: string;
  messages: ScorelMessage[];
  db: Database.Database;
  adapter: ProviderAdapter;
  providerConfig: ProviderConfig;
  apiKey: string;
  providerId: string;
  modelId: string;
  transcriptDir?: string;
}): Promise<ManualCompactResult> {
  if (opts.messages.length === 0) {
    throw new Error("Cannot compact an empty session");
  }

  const serializedMessages = trimSerializedMessages(opts.messages);
  const prompt = buildCompactSummaryPrompt(serializedMessages);

  const summaryResponse = await opts.adapter.stream(
    opts.providerConfig,
    opts.apiKey,
    {
      systemPrompt: "",
      messages: [{
        role: "user",
        id: `compact-input-${generateId()}`,
        content: prompt,
        ts: Date.now(),
      }],
      providerId: opts.providerId,
      modelId: opts.modelId,
    },
    () => {},
  );

  const summaryText = collectAssistantText(summaryResponse);
  if (!summaryText) {
    throw new Error("Compact summary response was empty");
  }

  const compactionId = generateId();
  const boundaryMessageId = opts.messages[opts.messages.length - 1].id;

  let transcriptPath: string | undefined;
  if (opts.transcriptDir) {
    transcriptPath = await saveCompactTranscript(
      opts.transcriptDir,
      opts.sessionId,
      compactionId,
      opts.messages,
    );
  }

  const record: CompactionRecord = {
    id: compactionId,
    sessionId: opts.sessionId,
    boundaryMessageId,
    summaryText,
    providerId: opts.providerId,
    modelId: opts.modelId,
    transcriptPath: transcriptPath ?? null,
    createdAt: Date.now(),
  };

  const persist = opts.db.transaction(() => {
    insertCompaction(opts.db, record);
  });
  persist();

  return {
    compactionId,
    summaryText,
    boundaryMessageId,
    transcriptPath,
  };
}
