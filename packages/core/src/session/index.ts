import { createHash } from "node:crypto";
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
  type SystemReminderKind,
  type SystemReminderScope,
  type SystemReminderVisibility,
  type SkillIndexEntry,
  type Seq,
  type SessionId,
  type SessionMeta,
} from "@scorel/protocol";

import {
  buildObservation,
  type RunCostEstimate,
  type RunReportingModel,
} from "../reporting/index.js";
import {
  appendSystemReminderToToolResult,
  cloneSystemReminderBlock,
  createSystemReminderBlock,
  systemReminderMessage,
} from "../reminders/index.js";

type MessagePersistentEvent = Extract<PersistentEvent, { message: ScorelMessage }>;
type CompactPersistentEvent = Extract<PersistentEvent, { type: "compact" }>;
type ConversationPersistentEvent = MessagePersistentEvent | HarnessItemEvent | CompactPersistentEvent;

export const snipUserMessageAlias = (eventId: EventId): string =>
  `u_${createHash("sha256").update(eventId).digest("hex").slice(0, 8)}`;

export type HiddenUserTurnSpan = {
  anchorUserEventId: EventId;
  throughEventId: EventId;
};

export type SessionControlState = {
  instructionSnapshot?: InstructionSnapshot;
  queues: Record<QueueName, QueueItem[]>;
  skillIndexInitialized: boolean;
  skillIndex: Record<string, SkillIndexEntry>;
  hiddenUserTurnSpans: HiddenUserTurnSpan[];
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

export type SessionObservationSummary = {
  format: "scorel-session-observation-v1";
  sessionId: string;
  deviceId: string;
  projectId: string;
  createdAt: number;
  updatedAt: number;
  sourceSessionJsonl: string;
  eventCount: number;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    totalTokens: number;
  };
  model?: RunReportingModel;
  cost: RunCostEstimate;
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
    hiddenUserTurnSpans: [],
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
    } else if (event.type === "context_control") {
      this.controlState.hiddenUserTurnSpans = [
        ...this.controlState.hiddenUserTurnSpans.filter(
          (span) => span.anchorUserEventId !== event.anchorUserEventId,
        ),
        {
          anchorUserEventId: event.anchorUserEventId,
          throughEventId: event.throughEventId,
        },
      ];
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
    await writeSessionObservationSummary(this).catch(() => undefined);
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

export const sessionObservationSummaryFilePath = (sessionsDir: string, sessionId: SessionId): string =>
  join(sessionsDir, `${sessionId}.summary.json`);

export const createSession = async ({ sessionsDir, header }: CreateSessionOptions): Promise<JsonlSession> => {
  const validHeader = parseHeader(header);
  await mkdir(sessionsDir, { recursive: true });
  const filePath = sessionFilePath(sessionsDir, validHeader.sessionId);
  await writeFile(filePath, `${JSON.stringify(validHeader)}\n`, { encoding: "utf8", flag: "wx" });
  const session = new JsonlSession(filePath, validHeader);
  await writeSessionObservationSummary(session).catch(() => undefined);
  return session;
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
  const session = new JsonlSession(filePath, header, tree);
  await writeSessionObservationSummary(session).catch(() => undefined);
  return session;
};

export const buildSessionObservationSummary = (session: JsonlSession): SessionObservationSummary => {
  const events = [...session.tree];
  const observation = buildObservation({
    events,
    selectedModel: reportingModelFromSessionMeta(
      session.header.meta,
      latestSessionSelectedModel(session.header.meta.selectedModel, events),
    ),
  });
  return {
    format: "scorel-session-observation-v1",
    sessionId: String(session.header.sessionId),
    deviceId: String(session.header.deviceId),
    projectId: String(session.header.meta.projectId),
    createdAt: session.header.createdAt,
    updatedAt: latestSessionTimestamp(session.header, events),
    sourceSessionJsonl: session.filePath,
    eventCount: events.length,
    usage: observation.usage,
    ...(observation.model ? { model: observation.model } : {}),
    cost: observation.cost,
  };
};

export const writeSessionObservationSummary = async (session: JsonlSession): Promise<SessionObservationSummary> => {
  const summary = buildSessionObservationSummary(session);
  const summaryPath = sessionObservationSummaryFilePath(dirname(session.filePath), session.header.sessionId);
  await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  return summary;
};

export const readSessionObservationSummary = async (
  sessionsDir: string,
  sessionId: SessionId,
): Promise<SessionObservationSummary> => {
  const content = await readFile(sessionObservationSummaryFilePath(sessionsDir, sessionId), "utf8");
  const value = JSON.parse(content) as SessionObservationSummary;
  return value;
};

const reportingModelFromSessionMeta = (
  meta: SessionMeta,
  selected = meta.selectedModel,
): RunReportingModel | undefined => {
  const model = {
    ...(stringValue(selected?.id ?? meta.model ?? selected?.modelId)
      ? { modelId: stringValue(selected?.id ?? meta.model ?? selected?.modelId) }
      : {}),
    ...(stringValue(selected?.modelId) ? { providerModelId: stringValue(selected?.modelId) } : {}),
    ...(stringValue(selected?.provider) ? { provider: stringValue(selected?.provider) } : {}),
    ...(stringValue(selected?.displayName) ? { displayName: stringValue(selected?.displayName) } : {}),
    ...(selected?.reasoningEffort ? { reasoningEffort: selected.reasoningEffort } : {}),
  };
  return Object.values(model).some((value) => value !== undefined) ? model : undefined;
};

const latestSessionSelectedModel = (
  initial: SessionMeta["selectedModel"],
  events: PersistentEvent[],
): SessionMeta["selectedModel"] =>
  events.reduce(
    (selected, event) => event.type === "session_model_selected" ? event.selectedModel : selected,
    initial,
  );

const latestSessionTimestamp = (header: SessionHeader, events: PersistentEvent[]): number =>
  events.reduce((latest, event) => Math.max(latest, event.ts), header.meta.updatedAt ?? header.createdAt);

const stringValue = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

export const buildContext = (tree: SessionTree, leafId: EventId): ScorelMessage[] => {
  const path = tree.getPath(leafId);
  const hiddenIds = hiddenContextEventIds(tree, path, leafId);
  return path.reduce<ScorelMessage[]>((messages, id, index) => {
    if (hiddenIds.has(id)) {
      return messages;
    }
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
      const retained = retainedMessagesBeforeCompact(tree, path.slice(0, index), event.retainedEventCount, hiddenIds);
      messages.length = 0;
      messages.push(compactSummaryMessage(event));
      messages.push(...retained);
    }
    return messages;
  }, []);
};

const hiddenContextEventIds = (tree: SessionTree, path: EventId[], leafId: EventId): Set<EventId> => {
  const leaf = tree.get(leafId)?.event;
  if (!leaf) {
    return new Set();
  }
  const pathIndexes = new Map(path.map((id, index) => [id, index]));
  const hidden = new Set<EventId>();
  for (const event of tree) {
    if (event.type !== "context_control" || Number(event.seq) > Number(leaf.seq)) {
      continue;
    }
    const start = pathIndexes.get(event.anchorUserEventId);
    const end = pathIndexes.get(event.throughEventId);
    if (start === undefined || end === undefined || end < start) {
      continue;
    }
    for (const id of path.slice(start, end + 1)) {
      hidden.add(id);
    }
  }
  return hidden;
};

const retainedMessagesBeforeCompact = (
  tree: SessionTree,
  pathBeforeCompact: EventId[],
  retainedEventCount: number,
  hiddenIds = new Set<EventId>(),
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
    if (hiddenIds.has(id)) {
      continue;
    }
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
    value.type !== "session_model_selected" &&
    value.type !== "instruction_snapshot" &&
    value.type !== "harness_item" &&
    value.type !== "compact" &&
    value.type !== "context_control" &&
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
  if (value.type === "session_model_selected" && !isSelectedModelSummary(value.selectedModel)) {
    throw new SessionStoreError("invalid_event", "session_model_selected is missing selectedModel payload");
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
  if (value.type === "context_control" && !isContextControlEvent(value)) {
    throw new SessionStoreError("invalid_event", "context_control is missing hide_user_turn payload");
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

const isSelectedModelSummary = (value: unknown): boolean =>
  isRecord(value) &&
  typeof value.modelId === "string" &&
  typeof value.providerId === "string" &&
  typeof value.provider === "string" &&
  typeof value.id === "string" &&
  typeof value.displayName === "string" &&
  (
    value.reasoningEffort === undefined ||
    value.reasoningEffort === "minimal" ||
    value.reasoningEffort === "low" ||
    value.reasoningEffort === "medium" ||
    value.reasoningEffort === "high" ||
    value.reasoningEffort === "xhigh" ||
    value.reasoningEffort === "max"
  );

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

const isContextControlEvent = (value: Record<string, unknown>): boolean =>
  value.operation === "hide_user_turn" &&
  typeof value.anchorUserEventId === "string" &&
  typeof value.throughEventId === "string" &&
  (value.actor === "agent" || value.actor === "user" || value.actor === "system") &&
  (value.reason === undefined || typeof value.reason === "string");

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
  const reminder = createSystemReminderBlock({
    kind: reminderKindFromHarness(event.item.kind),
    origin: event.item.origin,
    text: event.item.content,
    visibility: reminderVisibilityFromHarness(event.item.visibility),
    scope: reminderScopeFromHarness(event.item.kind),
    ...(event.item.data ? { data: event.item.data } : {}),
  });
  const last = messages.at(-1);
  if (last?.role === "tool_result" && appendSystemReminderToToolResult(last, reminder)) {
    return;
  }
  messages.push(systemReminderMessage(reminder, {
    source: "harness_item",
    harnessKind: event.item.kind,
    harnessOrigin: event.item.origin,
  }));
};

const compactSummaryMessage = (event: CompactPersistentEvent): ScorelMessage => ({
  role: "user",
  content: [createSystemReminderBlock({
    kind: "compact_summary",
    origin: "system",
    text: [
      "Earlier session context has been compacted.",
      "",
      event.summary.trim(),
      "",
      "Use this summary as continuity context. Verify current repository facts before acting.",
    ].join("\n"),
    visibility: "model",
    scope: "session",
  })],
  meta: {
    source: "compact",
    compactedThrough: event.compactedThrough,
  },
});

const reminderKindFromHarness = (kind: HarnessItemEvent["item"]["kind"]): SystemReminderKind => {
  if (
    kind === "attachment" ||
    kind === "skill_listing" ||
    kind === "skill_delta" ||
    kind === "memory" ||
    kind === "channel_context" ||
    kind === "steer" ||
    kind === "runtime_notice"
  ) {
    return kind;
  }
  if (kind === "date_change") {
    return "time";
  }
  return "runtime_notice";
};

const reminderVisibilityFromHarness = (
  visibility: HarnessItemEvent["item"]["visibility"],
): SystemReminderVisibility => {
  if (visibility === "hidden") {
    return "model";
  }
  return visibility;
};

const reminderScopeFromHarness = (kind: HarnessItemEvent["item"]["kind"]): SystemReminderScope => {
  if (kind === "steer" || kind === "skill_delta" || kind === "runtime_notice") {
    return "next_model_call";
  }
  if (kind === "channel_context" || kind === "attachment" || kind === "date_change") {
    return "turn";
  }
  return "session";
};

const cloneMessage = (message: ScorelMessage): ScorelMessage => ({
  ...message,
  content: message.content.map((block) => {
    if (block.type === "system_reminder") {
      return cloneSystemReminderBlock(block);
    }
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
