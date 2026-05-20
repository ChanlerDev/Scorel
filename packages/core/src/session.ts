import { appendFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { ScorelRuntime } from "./runtime.js";
import type { Api, Model } from "./llm.js";
import type { ScorelMessage, ScorelRuntimeOptions, ScorelStreamSimple, ScorelTool } from "./types.js";

export type MessageLogEntry = {
  kind: "message";
  id: string;
  at: number;
  message: ScorelMessage;
};

export type ChannelLogEntry = {
  kind: "channel";
  at: number;
  channel: string;
  externalId: string;
};

export type RewindLogEntry = {
  kind: "rewind";
  id: string;
  at: number;
  targetMessageId: string;
};

export type CompactLogEntry = {
  kind: "compact";
  id: string;
  at: number;
};

export type LogEntry = MessageLogEntry | ChannelLogEntry | RewindLogEntry | CompactLogEntry;

export type AppendLogEntry =
  | (Omit<MessageLogEntry, "id"> & { id?: string })
  | ChannelLogEntry
  | (Omit<RewindLogEntry, "id"> & { id?: string })
  | (Omit<CompactLogEntry, "id"> & { id?: string });

export type ScorelHistoryItem = {
  id: string;
  at: number;
  message: ScorelMessage;
  rewindable: boolean;
};

export type ReplayResult = {
  messages: ScorelMessage[];
  history: ScorelHistoryItem[];
};

export type SessionMeta = {
  id: string;
  createdAt: number;
  updatedAt: number;
  cwd?: string;
  model?: {
    provider: string;
    id: string;
  };
};

export type SessionStoreOptions = {
  sessionsDir: string;
  sessionId?: string;
};

export type RuntimeSessionOptions = {
  store: SessionStore;
  model: Model<Api>;
  systemPrompt?: string;
  tools?: ScorelTool[];
  streamSimple?: ScorelStreamSimple;
  streamOptions?: ScorelRuntimeOptions["streamOptions"];
  hooks?: ScorelRuntimeOptions["hooks"];
};

export type ForkSessionOptions = Omit<RuntimeSessionOptions, "store"> & {
  sessionId?: string;
};

export class SessionStore {
  readonly sessionsDir: string;
  readonly sessionId: string;
  readonly sessionDir: string;
  readonly logPath: string;
  readonly metaPath: string;

  constructor(options: SessionStoreOptions) {
    this.sessionsDir = options.sessionsDir;
    this.sessionId = options.sessionId ?? createSessionId();
    this.sessionDir = join(this.sessionsDir, this.sessionId);
    this.logPath = join(this.sessionDir, "log.jsonl");
    this.metaPath = join(this.sessionDir, "meta.json");
  }

  async ensure(meta: { cwd?: string; model?: SessionMeta["model"] } = {}): Promise<void> {
    await mkdir(this.sessionDir, { recursive: true });
    const existing = await this.readMetaIfExists();
    const now = Date.now();
    const next: SessionMeta = {
      id: this.sessionId,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      cwd: meta.cwd ?? existing?.cwd,
      model: meta.model ?? existing?.model
    };
    await writeFile(this.metaPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  }

  async append(entry: AppendLogEntry): Promise<LogEntry> {
    await mkdir(this.sessionDir, { recursive: true });
    const normalized = normalizeAppendLogEntry(entry);
    await appendFile(this.logPath, `${JSON.stringify(normalized)}\n`, "utf8");
    return normalized;
  }

  async readEntries(): Promise<LogEntry[]> {
    let contents: string;
    try {
      contents = await readFile(this.logPath, "utf8");
    } catch (error) {
      if (isNotFound(error)) {
        return [];
      }
      throw error;
    }

    const lines = contents.split("\n").filter((line) => line.trim().length > 0);
    return lines.map((line, index) => {
      try {
        return normalizeReadLogEntry(JSON.parse(line), index);
      } catch (error) {
        throw new Error(`Invalid session log JSON at ${this.logPath}:${index + 1}: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
  }

  private async readMetaIfExists(): Promise<SessionMeta | undefined> {
    try {
      return JSON.parse(await readFile(this.metaPath, "utf8")) as SessionMeta;
    } catch (error) {
      if (isNotFound(error)) {
        return undefined;
      }
      throw error;
    }
  }
}

export async function findLatestSessionId(sessionsDir: string): Promise<string | undefined> {
  let entries: Array<{ name: string; isDirectory: () => boolean }>;
  try {
    entries = await readdir(sessionsDir, { withFileTypes: true });
  } catch (error) {
    if (isNotFound(error)) {
      return undefined;
    }
    throw error;
  }

  let latest: { id: string; updatedAt: number } | undefined;
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const meta = await readSessionMeta(join(sessionsDir, entry.name, "meta.json"));
    if (!meta) {
      continue;
    }
    if (!latest || meta.updatedAt > latest.updatedAt) {
      latest = { id: meta.id, updatedAt: meta.updatedAt };
    }
  }
  return latest?.id;
}

export class ScorelSession {
  readonly store: SessionStore;
  readonly runtime: ScorelRuntime;
  private readonly options: RuntimeSessionOptions;
  private entries: LogEntry[];

  private constructor(store: SessionStore, runtime: ScorelRuntime, options: RuntimeSessionOptions, entries: LogEntry[]) {
    this.store = store;
    this.runtime = runtime;
    this.options = options;
    this.entries = entries;
  }

  static async create(options: RuntimeSessionOptions): Promise<ScorelSession> {
    await options.store.ensure({
      cwd: process.cwd(),
      model: { provider: options.model.provider, id: options.model.id }
    });
    const entries = await options.store.readEntries();
    const replayed = replayLogEntries(entries);
    const runtime = new ScorelRuntime({
      model: options.model,
      sessionId: options.store.sessionId,
      systemPrompt: options.systemPrompt,
      tools: options.tools,
      streamSimple: options.streamSimple,
      streamOptions: options.streamOptions,
      hooks: options.hooks,
      messages: replayed.messages
    });

    const thisSession = new ScorelSession(options.store, runtime, options, entries);

    runtime.subscribe(async (event) => {
      if (event.type === "message_end") {
        const entry = await options.store.append({ kind: "message", at: Date.now(), message: event.message });
        thisSession.entries.push(entry);
      }
    });

    return thisSession;
  }

  prompt(message: string | ScorelMessage | ScorelMessage[]): Promise<void> {
    return this.persistInput(message).then(() => this.runtime.prompt(message));
  }

  history(): ScorelHistoryItem[] {
    return replayLogEntries(this.entries).history;
  }

  async rewind(targetMessageId: string): Promise<ReplayResult> {
    const marker = await this.store.append({ kind: "rewind", at: Date.now(), targetMessageId });
    this.entries.push(marker);
    const replayed = replayLogEntries(this.entries);
    this.runtime.loadMessages(replayed.messages);
    return replayed;
  }

  async fork(targetMessageId: string, options: Partial<ForkSessionOptions> = {}): Promise<ScorelSession> {
    const prefix = prefixEntriesForTarget(this.entries, targetMessageId);
    const store = new SessionStore({ sessionsDir: this.store.sessionsDir, sessionId: options.sessionId });
    await store.ensure({
      cwd: process.cwd(),
      model: { provider: this.options.model.provider, id: this.options.model.id }
    });
    for (const entry of prefix) {
      await store.append(entry);
    }
    return ScorelSession.create({
      ...this.options,
      ...options,
      store
    });
  }

  private async persistInput(message: string | ScorelMessage | ScorelMessage[]): Promise<void> {
    for (const item of toMessages(message)) {
      const entry = await this.store.append({ kind: "message", at: Date.now(), message: item });
      this.entries.push(entry);
    }
  }
}

export function replayLogEntries(entries: LogEntry[]): ReplayResult {
  const activeEntries: MessageLogEntry[] = [];
  for (const entry of entries) {
    if (entry.kind === "message") {
      activeEntries.push(entry);
      continue;
    }
    if (entry.kind === "rewind") {
      rewindEntries(activeEntries, entry.targetMessageId);
    }
  }
  return toReplayResult(activeEntries);
}

function createSessionId(): string {
  return randomUUID();
}

function createLogEntryId(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}

function normalizeAppendLogEntry(entry: AppendLogEntry): LogEntry {
  if (entry.kind === "message") {
    return { ...entry, id: entry.id ?? createLogEntryId("msg") };
  }
  if (entry.kind === "rewind") {
    return { ...entry, id: entry.id ?? createLogEntryId("rewind") };
  }
  if (entry.kind === "compact") {
    return { ...entry, id: entry.id ?? createLogEntryId("compact") };
  }
  return entry;
}

function normalizeReadLogEntry(entry: unknown, index: number): LogEntry {
  if (!isLogEntryLike(entry)) {
    throw new Error("Entry is not an object");
  }
  if (entry.kind === "message") {
    return { ...(entry as Omit<MessageLogEntry, "id"> & { id?: string }), id: typeof entry.id === "string" ? entry.id : `legacy-msg-${index + 1}` };
  }
  if (entry.kind === "rewind") {
    return { ...(entry as Omit<RewindLogEntry, "id"> & { id?: string }), id: typeof entry.id === "string" ? entry.id : `legacy-rewind-${index + 1}` };
  }
  if (entry.kind === "compact") {
    return { ...(entry as Omit<CompactLogEntry, "id"> & { id?: string }), id: typeof entry.id === "string" ? entry.id : `legacy-compact-${index + 1}` };
  }
  if (entry.kind === "channel") {
    return entry as ChannelLogEntry;
  }
  throw new Error(`Unsupported session log entry kind: ${String(entry.kind)}`);
}

function isLogEntryLike(entry: unknown): entry is { kind: unknown; id?: unknown } {
  return typeof entry === "object" && entry !== null && "kind" in entry;
}

function isRewindableBoundary(entry: MessageLogEntry): boolean {
  return entry.message.role === "user";
}

function rewindEntries(entries: MessageLogEntry[], targetMessageId: string): void {
  const index = entries.findIndex((entry) => entry.id === targetMessageId);
  if (index === -1) {
    throw new Error(`Cannot rewind to ${targetMessageId}: message id was not found in active history`);
  }
  if (!isRewindableBoundary(entries[index])) {
    throw new Error(`Cannot rewind to ${targetMessageId}: not a rewindable turn boundary`);
  }
  entries.splice(index + 1);
}

function prefixEntriesForTarget(entries: LogEntry[], targetMessageId: string): MessageLogEntry[] {
  const activeEntries: MessageLogEntry[] = [];
  for (const entry of entries) {
    if (entry.kind === "message") {
      activeEntries.push(entry);
      continue;
    }
    if (entry.kind === "rewind") {
      rewindEntries(activeEntries, entry.targetMessageId);
    }
  }
  const index = activeEntries.findIndex((entry) => entry.id === targetMessageId);
  if (index === -1) {
    throw new Error(`Cannot fork from ${targetMessageId}: message id was not found in active history`);
  }
  if (!isRewindableBoundary(activeEntries[index])) {
    throw new Error(`Cannot fork from ${targetMessageId}: not a rewindable turn boundary`);
  }
  return activeEntries.slice(0, index + 1);
}

function toReplayResult(entries: MessageLogEntry[]): ReplayResult {
  return {
    messages: entries.map((entry) => entry.message),
    history: entries.map((entry) => ({
      id: entry.id,
      at: entry.at,
      message: entry.message,
      rewindable: isRewindableBoundary(entry)
    }))
  };
}

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

async function readSessionMeta(path: string): Promise<SessionMeta | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as SessionMeta;
  } catch (error) {
    if (isNotFound(error)) {
      return undefined;
    }
    throw error;
  }
}

function toMessages(input: string | ScorelMessage | ScorelMessage[]): ScorelMessage[] {
  if (typeof input === "string") {
    return [{ role: "user", content: input, timestamp: Date.now() }];
  }
  return Array.isArray(input) ? input : [input];
}
