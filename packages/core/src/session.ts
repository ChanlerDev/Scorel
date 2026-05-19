import { appendFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { ScorelRuntime } from "./runtime.js";
import type { Api, Model } from "./llm.js";
import type { ScorelMessage, ScorelRuntimeOptions, ScorelStreamSimple, ScorelTool } from "./types.js";

export type MessageLogEntry = {
  kind: "message";
  at: number;
  message: ScorelMessage;
};

export type ChannelLogEntry = {
  kind: "channel";
  at: number;
  channel: string;
  externalId: string;
};

export type LogEntry = MessageLogEntry | ChannelLogEntry;

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

  async append(entry: LogEntry): Promise<void> {
    await mkdir(this.sessionDir, { recursive: true });
    await appendFile(this.logPath, `${JSON.stringify(entry)}\n`, "utf8");
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
        return JSON.parse(line) as LogEntry;
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

  private constructor(store: SessionStore, runtime: ScorelRuntime) {
    this.store = store;
    this.runtime = runtime;
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
      messages: replayed.messages
    });

    runtime.subscribe(async (event) => {
      if (event.type === "message_end") {
        await options.store.append({ kind: "message", at: Date.now(), message: event.message });
      }
    });

    return new ScorelSession(options.store, runtime);
  }

  prompt(message: string | ScorelMessage | ScorelMessage[]): Promise<void> {
    return this.persistInput(message).then(() => this.runtime.prompt(message));
  }

  private async persistInput(message: string | ScorelMessage | ScorelMessage[]): Promise<void> {
    for (const item of toMessages(message)) {
      await this.store.append({ kind: "message", at: Date.now(), message: item });
    }
  }
}

export function replayLogEntries(entries: LogEntry[]): { messages: ScorelMessage[] } {
  return {
    messages: entries.flatMap((entry) => (entry.kind === "message" ? [entry.message] : []))
  };
}

function createSessionId(): string {
  return randomUUID();
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
