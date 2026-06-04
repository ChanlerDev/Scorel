import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  asSeq,
  type DeviceId,
  type EventId,
  type InstructionSnapshot,
  type PersistentEvent,
  type ScorelMessage,
  type Seq,
  type SessionId,
  type SessionMeta,
} from "@scorel/protocol";

type MessagePersistentEvent = Extract<PersistentEvent, { message: ScorelMessage }>;
type ConversationPersistentEvent = MessagePersistentEvent;

export type SessionControlState = {
  instructionSnapshot?: InstructionSnapshot;
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
  readonly controlState: SessionControlState = {};

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

export const buildContext = (tree: SessionTree, leafId: EventId): ScorelMessage[] =>
  tree
    .getPath(leafId)
    .map((id) => tree.get(id)?.event)
    .filter((event): event is MessagePersistentEvent => event !== undefined && "message" in event)
    .map((event) => event.message);

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
    value.type !== "instruction_snapshot"
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
  if (value.type === "instruction_snapshot" && !isInstructionSnapshot(value.snapshot)) {
    throw new SessionStoreError("invalid_event", "instruction_snapshot is missing snapshot payload");
  }
}

const isConversationEvent = (event: PersistentEvent): event is ConversationPersistentEvent =>
  event.type === "user_message" || event.type === "assistant_message" || event.type === "tool_result";

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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
