import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  asSeq,
  type DeviceId,
  type EventId,
  type HarnessItemEvent,
  type InstructionSnapshot,
  type PersistentEvent,
  type QueueItem,
  type QueueName,
  type ScorelMessage,
  type SkillIndexEntry,
  type ToolResultContentBlock,
  type Seq,
  type SessionId,
  type SessionMeta,
} from "@scorel/protocol";

type MessagePersistentEvent = Extract<PersistentEvent, { message: ScorelMessage }>;
type CompactPersistentEvent = Extract<PersistentEvent, { type: "compact" }>;
type ConversationPersistentEvent = MessagePersistentEvent | HarnessItemEvent | CompactPersistentEvent;

export type SessionControlState = {
  instructionSnapshot?: InstructionSnapshot;
  queues: Record<QueueName, QueueItem[]>;
  skillIndexInitialized: boolean;
  skillIndex: Record<string, SkillIndexEntry>;
};

export type SessionHeader = {
  version: 1;
  sessionId: SessionId;
  deviceId: DeviceId;
  createdAt: number;
  clonedFrom?: {
    sessionId: SessionId;
    deviceId: DeviceId;
    eventId: EventId;
  };
  meta: SessionMeta;
};

export type SessionStoreErrorCode =
  | "missing_header"
  | "invalid_header"
  | "invalid_event"
  | "invalid_json"
  | "duplicate_event_id"
  | "invalid_parent"
  | "non_monotonic_seq"
  | "session_mismatch";

export class SessionStoreError extends Error {
  readonly code: SessionStoreErrorCode;
  readonly line?: number;

  constructor(code: SessionStoreErrorCode, message: string, options?: { line?: number }) {
    super(message);
    this.name = "SessionStoreError";
    this.code = code;
    this.line = options?.line;
  }
}

export type TreeNode = {
  readonly event: PersistentEvent;
  readonly children: readonly EventId[];
};

type MutableTreeNode = {
  event: PersistentEvent;
  children: EventId[];
};

export class SessionTree implements Iterable<PersistentEvent> {
  #nodes = new Map<EventId, MutableTreeNode>();
  #events = new Map<EventId, PersistentEvent>();
  #order: EventId[] = [];
  #conversationOrder: EventId[] = [];
  #rootId: EventId | null = null;
  #currentSeq = asSeq(0);
  readonly controlState: SessionControlState = {
    queues: {
      follow_up: [],
      steer: [],
    },
    skillIndexInitialized: false,
    skillIndex: {},
  };

  get rootId(): EventId | null {
    return this.#rootId;
  }

  get size(): number {
    return this.#events.size;
  }

  get currentSeq(): Seq {
    return this.#currentSeq;
  }

  get(id: EventId): TreeNode | undefined {
    const node = this.#nodes.get(id);
    if (!node) {
      return undefined;
    }
    return {
      event: node.event,
      children: [...node.children],
    };
  }

  has(id: EventId): boolean {
    return this.#events.has(id);
  }

  append(event: PersistentEvent): void {
    this.assertCanAppend(event);

    this.#events.set(event.id, event);
    this.#order.push(event.id);
    this.#currentSeq = event.seq;
    this.#applyControlEvent(event);

    if (!isConversationEvent(event)) {
      return;
    }

    if (event.parentId !== null) {
      this.#nodes.get(event.parentId)?.children.push(event.id);
    } else {
      this.#rootId = event.id;
    }
    this.#nodes.set(event.id, { event, children: [] });
    this.#conversationOrder.push(event.id);
  }

  assertCanAppend(event: PersistentEvent): void {
    assertTreeEvent(event);

    if (this.#events.has(event.id)) {
      throw new SessionStoreError("duplicate_event_id", `Duplicate event id: ${event.id}`);
    }

    if (Number(event.seq) <= Number(this.#currentSeq)) {
      throw new SessionStoreError(
        "non_monotonic_seq",
        `Event seq ${String(event.seq)} must be greater than ${String(this.#currentSeq)}`,
      );
    }

    if (!isConversationEvent(event)) {
      return;
    }

    if (event.parentId === null) {
      if (this.#rootId !== null) {
        throw new SessionStoreError("invalid_parent", "Only the first event can have a null parentId");
      }
    } else {
      const parent = this.#nodes.get(event.parentId);
      if (!parent) {
        throw new SessionStoreError("invalid_parent", `Missing parent event: ${event.parentId}`);
      }
    }
  }

  getLeaves(): EventId[] {
    return this.#conversationOrder.filter((id) => this.#nodes.get(id)?.children.length === 0);
  }

  getChildren(id: EventId): EventId[] {
    return [...(this.#nodes.get(id)?.children ?? [])];
  }

  getPath(id: EventId): EventId[] {
    if (!this.#nodes.has(id)) {
      throw new SessionStoreError("invalid_parent", `Unknown event id: ${id}`);
    }

    const path: EventId[] = [];
    let current: EventId | null = id;
    while (current !== null) {
      const node = this.#nodes.get(current);
      if (!node) {
        throw new SessionStoreError("invalid_parent", `Broken path at event id: ${current}`);
      }
      path.push(current);
      current = node.event.parentId;
    }
    return path.reverse();
  }

  getBranchPoints(): EventId[] {
    return this.#conversationOrder.filter((id) => (this.#nodes.get(id)?.children.length ?? 0) > 1);
  }

  *[Symbol.iterator](): Iterator<PersistentEvent> {
    for (const id of this.#order) {
      const event = this.#events.get(id);
      if (event) {
        yield event;
      }
    }
  }

  #applyControlEvent(event: PersistentEvent): void {
    if (event.type === "instruction_snapshot") {
      this.controlState.instructionSnapshot = event.snapshot;
    } else if (event.type === "queue_update") {
      this.controlState.queues[event.queue] = [...event.items];
    } else if (event.type === "skill_index_snapshot") {
      this.controlState.skillIndexInitialized = true;
      this.controlState.skillIndex = Object.fromEntries(event.entries.map((entry) => [entry.name, entry]));
    } else if (event.type === "skill_index_delta") {
      this.controlState.skillIndexInitialized = true;
      const next = { ...this.controlState.skillIndex };
      for (const entry of event.added) {
        next[entry.name] = entry;
      }
      for (const entry of event.changed) {
        next[entry.name] = entry;
      }
      for (const removed of event.removed) {
        delete next[removed.name];
      }
      this.controlState.skillIndex = next;
    }
  }
}

export type CreateSessionOptions = {
  sessionsDir: string;
  header: SessionHeader;
};

export type LoadSessionOptions =
  | {
      sessionsDir: string;
      sessionId: SessionId;
      filePath?: never;
    }
  | {
      filePath: string;
      sessionsDir?: never;
      sessionId?: never;
    };

export class JsonlSession {
  readonly filePath: string;
  readonly header: SessionHeader;
  readonly tree: SessionTree;

  constructor(filePath: string, header: SessionHeader, tree = new SessionTree()) {
    this.filePath = filePath;
    this.header = header;
    this.tree = tree;
  }

  get activeLeafId(): EventId | null {
    const leaves = this.tree.getLeaves();
    return leaves.at(-1) ?? null;
  }

  get currentSeq(): Seq {
    return this.tree.currentSeq;
  }

  async append(event: PersistentEvent): Promise<PersistentEvent> {
    validateSessionMatch(this.header, event);
    this.tree.assertCanAppend(event);
    await appendFile(this.filePath, `${JSON.stringify(event)}\n`, "utf8");
    this.tree.append(event);
    return event;
  }

  async close(): Promise<void> {
    return Promise.resolve();
  }
}

export const sessionFilePath = (sessionsDir: string, sessionId: SessionId): string =>
  join(sessionsDir, `${sessionId}.jsonl`);

export const sessionLogFilePath = (sessionsDir: string, sessionId: SessionId): string =>
  join(sessionsDir, `${sessionId}.log`);

export const sessionArtifactsDirPath = (sessionsDir: string, sessionId: SessionId): string =>
  join(sessionsDir, `${sessionId}.artifacts`);

export const createSession = async ({ sessionsDir, header }: CreateSessionOptions): Promise<JsonlSession> => {
  const validHeader = parseHeader(header);
  await mkdir(sessionsDir, { recursive: true });
  const filePath = sessionFilePath(sessionsDir, validHeader.sessionId);
  await writeFile(filePath, `${JSON.stringify(validHeader)}\n`, { encoding: "utf8", flag: "wx" });
  return new JsonlSession(filePath, validHeader);
};

export const loadSession = async (options: LoadSessionOptions): Promise<JsonlSession> => {
  const filePath =
    options.filePath !== undefined ? options.filePath : sessionFilePath(options.sessionsDir, options.sessionId);
  const content = await readFile(filePath, "utf8");
  const lines: string[] = content.split(/\r?\n/);
  const headerLine = lines[0];

  if (!headerLine) {
    throw new SessionStoreError("missing_header", "Session file is missing a header");
  }

  const parsedLines = lines
    .map((line: string, index: number) => ({ line, lineNumber: index + 1 }))
    .filter(({ line }) => line.length > 0)
    .map(({ line, lineNumber }) => parseJsonLine(line, lineNumber));

  const header = parseHeader(parsedLines[0]);

  const tree = new SessionTree();
  for (const event of parsedLines.slice(1)) {
    tree.append(parseSessionEvent(header, event));
  }

  await mkdir(dirname(filePath), { recursive: true });
  return new JsonlSession(filePath, header, tree);
};

export const buildContext = (tree: SessionTree, leafId: EventId): ScorelMessage[] => {
  const path = tree.getPath(leafId);
  return path.reduce<ScorelMessage[]>((messages, id, index) => {
    const event = tree.get(id)?.event;
    if (!event) {
      return messages;
    }
    if ("message" in event) {
      messages.push(cloneMessage(event.message));
      return messages;
    }
    if (event.type === "harness_item") {
      appendHarnessItemToContext(messages, event);
    }
    if (event.type === "compact") {
      const retained = retainedMessagesBeforeCompact(tree, path.slice(0, index), event.retainedEventCount);
      messages.length = 0;
      messages.push(compactSummaryMessage(event));
      messages.push(...retained);
    }
    return messages;
  }, []);
};

const retainedMessagesBeforeCompact = (
  tree: SessionTree,
  pathBeforeCompact: EventId[],
  retainedEventCount: number,
): ScorelMessage[] => {
  if (retainedEventCount <= 0) {
    return [];
  }
  const candidateStart = Math.max(0, pathBeforeCompact.length - retainedEventCount);
  let start = pathBeforeCompact.length;
  for (let index = candidateStart; index < pathBeforeCompact.length; index += 1) {
    const event = tree.get(pathBeforeCompact[index])?.event;
    if (isRetainedContextStart(event)) {
      start = index;
      break;
    }
  }
  const retained: ScorelMessage[] = [];
  for (const id of pathBeforeCompact.slice(start)) {
    const event = tree.get(id)?.event;
    if (!event) {
      continue;
    }
    if ("message" in event) {
      retained.push(cloneMessage(event.message));
    } else if (event.type === "harness_item") {
      appendHarnessItemToContext(retained, event);
    } else if (event.type === "compact") {
      retained.length = 0;
      retained.push(compactSummaryMessage(event));
    }
  }
  return retained;
};

const isRetainedContextStart = (event: PersistentEvent | undefined): boolean =>
  event?.type === "user_message" ||
  event?.type === "compact" ||
  (
    event?.type === "assistant_message" &&
    event.message.content.some((block) => block.type === "tool_call")
  );

const parseJsonLine = (line: string, lineNumber: number): unknown => {
  try {
    return JSON.parse(line);
  } catch (cause) {
    throw new SessionStoreError("invalid_json", `Invalid JSON at line ${lineNumber}`, { line: lineNumber });
  }
};

const parseHeader = (value: unknown): SessionHeader => {
  if (!isRecord(value)) {
    throw new SessionStoreError("invalid_header", "Session header must be an object");
  }
  if (value.version !== 1 || typeof value.sessionId !== "string" || typeof value.deviceId !== "string") {
    throw new SessionStoreError("invalid_header", "Session header is missing required identity fields");
  }
  if (typeof value.createdAt !== "number" || !isRecord(value.meta)) {
    throw new SessionStoreError("invalid_header", "Session header is missing createdAt or meta");
  }
  if (typeof value.meta.projectId !== "string" || value.meta.projectId.length === 0) {
    throw new SessionStoreError("invalid_header", "Session header is missing meta.projectId");
  }
  return value as SessionHeader;
};

const parseSessionEvent = (header: SessionHeader, value: unknown): PersistentEvent => {
  validateSessionMatch(header, value);
  assertTreeEvent(value);
  return value;
};

const validateSessionMatch = (header: SessionHeader, value: unknown): void => {
  if (!isRecord(value) || typeof value.sessionId !== "string") {
    throw new SessionStoreError("invalid_header", "Event must be an object with a sessionId");
  }
  if (value.sessionId !== header.sessionId) {
    throw new SessionStoreError("session_mismatch", `Event belongs to ${value.sessionId}, expected ${header.sessionId}`);
  }
};

function assertTreeEvent(value: unknown): asserts value is PersistentEvent {
  if (!isRecord(value)) {
    throw new SessionStoreError("invalid_event", "Event must be an object");
  }
  if (value.type === "session_header") {
    throw new SessionStoreError("invalid_event", "Session header must be stored as the JSONL header line");
  }
  if (
    value.type !== "user_message" &&
    value.type !== "assistant_message" &&
    value.type !== "tool_result" &&
    value.type !== "session_title_updated" &&
    value.type !== "instruction_snapshot" &&
    value.type !== "harness_item" &&
    value.type !== "compact" &&
    value.type !== "queue_update" &&
    value.type !== "skill_index_snapshot" &&
    value.type !== "skill_index_delta"
  ) {
    throw new SessionStoreError("invalid_event", "Unsupported session event type");
  }
  if (
    typeof value.id !== "string" ||
    (value.parentId !== null && typeof value.parentId !== "string") ||
    typeof value.seq !== "number" ||
    typeof value.clientId !== "string" ||
    typeof value.ts !== "number"
  ) {
    throw new SessionStoreError("invalid_event", "Event is missing required base fields");
  }
  if (
    (value.type === "user_message" || value.type === "assistant_message" || value.type === "tool_result") &&
    !isRecord(value.message)
  ) {
    throw new SessionStoreError("invalid_event", "Message event is missing message payload");
  }
  if (value.type === "session_title_updated" && !isSessionTitleUpdated(value)) {
    throw new SessionStoreError("invalid_event", "session_title_updated is missing title payload");
  }
  if (value.type === "instruction_snapshot" && !isInstructionSnapshot(value.snapshot)) {
    throw new SessionStoreError("invalid_event", "instruction_snapshot is missing snapshot payload");
  }
  if (value.type === "harness_item" && !isHarnessItem(value.item)) {
    throw new SessionStoreError("invalid_event", "harness_item is missing item payload");
  }
  if (value.type === "compact" && !isCompactEvent(value)) {
    throw new SessionStoreError("invalid_event", "compact is missing summary payload");
  }
  if (value.type === "queue_update" && !isQueueUpdate(value)) {
    throw new SessionStoreError("invalid_event", "queue_update is missing queue payload");
  }
  if (value.type === "skill_index_snapshot" && !isSkillIndexSnapshot(value)) {
    throw new SessionStoreError("invalid_event", "skill_index_snapshot is missing entries");
  }
  if (value.type === "skill_index_delta" && !isSkillIndexDelta(value)) {
    throw new SessionStoreError("invalid_event", "skill_index_delta is missing delta payload");
  }
}

const isConversationEvent = (event: PersistentEvent): event is ConversationPersistentEvent =>
  event.type === "user_message" ||
  event.type === "assistant_message" ||
  event.type === "tool_result" ||
  event.type === "harness_item" ||
  event.type === "compact";

const isInstructionSnapshot = (value: unknown): value is InstructionSnapshot => {
  if (!isRecord(value) || value.version !== 1 || typeof value.cwd !== "string" || !Array.isArray(value.sections)) {
    return false;
  }
  return value.sections.every(
    (section) =>
      isRecord(section) &&
      typeof section.kind === "string" &&
      typeof section.frozenAt === "number" &&
      typeof section.renderedBlock === "string",
  );
};

const isHarnessItem = (value: unknown): boolean =>
  isRecord(value) &&
  typeof value.kind === "string" &&
  typeof value.origin === "string" &&
  typeof value.content === "string" &&
  (value.visibility === "display" || value.visibility === "hidden" || value.visibility === "compact");

const isCompactEvent = (value: Record<string, unknown>): boolean =>
  typeof value.summary === "string" &&
  typeof value.compactedThrough === "string" &&
  typeof value.tokensBefore === "number" &&
  typeof value.tokensAfter === "number" &&
  typeof value.retainedEventCount === "number";

const isQueueUpdate = (value: Record<string, unknown>): boolean =>
  (value.queue === "follow_up" || value.queue === "steer") &&
  value.operation === "rewrite" &&
  Array.isArray(value.items) &&
  (value.anchorEventId === null || typeof value.anchorEventId === "string") &&
  value.items.every(
    (item) =>
      isRecord(item) &&
      typeof item.id === "string" &&
      Array.isArray(item.content) &&
      typeof item.createdAt === "number" &&
      typeof item.updatedAt === "number" &&
      typeof item.clientId === "string",
  );

const isSessionTitleUpdated = (value: Record<string, unknown>): boolean =>
  typeof value.title === "string" &&
  value.title.length > 0 &&
  (value.source === "model" || value.source === "user") &&
  (value.derivedFrom === undefined ||
    (isRecord(value.derivedFrom) &&
      typeof value.derivedFrom.eventId === "string" &&
      typeof value.derivedFrom.seq === "number"));

const isSkillIndexSnapshot = (value: Record<string, unknown>): boolean =>
  (value.anchorEventId === null || typeof value.anchorEventId === "string") &&
  Array.isArray(value.entries) &&
  value.entries.every(isSkillIndexEntry);

const isSkillIndexDelta = (value: Record<string, unknown>): boolean =>
  (value.anchorEventId === null || typeof value.anchorEventId === "string") &&
  Array.isArray(value.added) &&
  Array.isArray(value.changed) &&
  Array.isArray(value.removed) &&
  value.added.every(isSkillIndexEntry) &&
  value.changed.every(isSkillIndexEntry) &&
  value.removed.every(
    (item) => isRecord(item) && typeof item.name === "string" && typeof item.previousPath === "string",
  );

const isSkillIndexEntry = (value: unknown): value is SkillIndexEntry =>
  isRecord(value) &&
  typeof value.name === "string" &&
  typeof value.path === "string" &&
  (value.scope === "user" || value.scope === "project" || value.scope === "extension") &&
  typeof value.description === "string" &&
  typeof value.mtimeMs === "number" &&
  typeof value.size === "number" &&
  typeof value.contentHash === "string" &&
  typeof value.priority === "number";

const appendHarnessItemToContext = (messages: ScorelMessage[], event: HarnessItemEvent): void => {
  const reminder = renderSystemReminder(event.item.content);
  const last = messages.at(-1);
  if (last?.role === "tool_result" && appendReminderToToolResult(last, reminder)) {
    return;
  }
  messages.push({
    role: "user",
    content: [{ type: "text", text: reminder }],
    meta: {
      source: "harness_item",
      harnessKind: event.item.kind,
      harnessOrigin: event.item.origin,
    },
  });
};

const appendReminderToToolResult = (message: ScorelMessage, reminder: string): boolean => {
  for (let i = message.content.length - 1; i >= 0; i -= 1) {
    const block = message.content[i];
    if (block?.type !== "tool_result" || !isToolResultWithContent(block.result)) {
      continue;
    }
    const mergedResult = {
      ...block.result,
      content: [...block.result.content, { type: "text" as const, text: `\n\n${reminder}` }],
    };
    message.content[i] = {
      ...block,
      result: mergedResult,
    } satisfies ToolResultContentBlock;
    return true;
  }
  return false;
};

const isToolResultWithContent = (value: unknown): value is { content: unknown[] } =>
  isRecord(value) && Array.isArray(value.content);

const renderSystemReminder = (content: string): string =>
  `<system-reminder>\n${content}\n</system-reminder>`;

const compactSummaryMessage = (event: CompactPersistentEvent): ScorelMessage => ({
  role: "user",
  content: [{
    type: "text",
    text: renderSystemReminder([
      "Earlier session context has been compacted.",
      "",
      event.summary.trim(),
      "",
      "Use this summary as continuity context. Verify current repository facts before acting.",
    ].join("\n")),
  }],
  meta: {
    source: "compact",
    compactedThrough: event.compactedThrough,
  },
});

const cloneMessage = (message: ScorelMessage): ScorelMessage => ({
  ...message,
  content: message.content.map((block) => {
    if (block.type !== "tool_result" || !isRecord(block.result)) {
      return { ...block };
    }
    const content = Array.isArray(block.result.content)
      ? { content: block.result.content.map((item) => (isRecord(item) ? { ...item } : item)) }
      : {};
    return {
      ...block,
      result: {
        content: content.content ?? [],
      },
    };
  }),
  ...(message.meta ? { meta: { ...message.meta } } : {}),
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
