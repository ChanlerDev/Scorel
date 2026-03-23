import type Database from "better-sqlite3";
import type {
  CompactionRecord,
  EmbeddingConfig,
  EmbeddingStatus,
  ProviderConfig,
  ScorelMessage,
} from "../../shared/types.js";
import { FTS_CONTENT_MAX_CHARS } from "../../shared/constants.js";
import { generateId } from "../core/id.js";
import {
  countActiveEmbeddings,
  findReusableEmbeddings,
  insertEmbeddings,
  listCompactionsForReindex,
  listMessagesForReindex,
  tombstoneEmbeddingsForSource,
  type EmbeddingSourceType,
  type StoredEmbedding,
} from "../storage/embeddings.js";
import { chunkTextForEmbedding } from "./chunking.js";

type ProviderEntry = {
  config: ProviderConfig;
  getApiKey: () => Promise<string | null>;
};

type MessageJob = {
  kind: "message";
  sessionId: string;
  message: ScorelMessage;
};

type CompactionJob = {
  kind: "compaction";
  compaction: CompactionRecord;
};

type Job = MessageJob | CompactionJob;

const EMBEDDING_BATCH_SIZE = 2048;

function normalizeVector(vector: Float32Array): Float32Array {
  let magnitude = 0;
  for (const value of vector) {
    magnitude += value * value;
  }

  if (magnitude === 0) {
    return vector;
  }

  const scale = 1 / Math.sqrt(magnitude);
  const normalized = new Float32Array(vector.length);
  for (let index = 0; index < vector.length; index += 1) {
    normalized[index] = vector[index]! * scale;
  }
  return normalized;
}

function vectorToBlob(vector: Float32Array): Buffer {
  return Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength);
}

function buildAuthHeaders(config: ProviderConfig, apiKey: string): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
    ...config.defaultHeaders,
  };

  if (config.auth.type === "bearer") {
    headers.Authorization = `Bearer ${apiKey}`;
  } else {
    headers[config.auth.headerName ?? "x-api-key"] = apiKey;
  }

  return headers;
}

function extractSearchableText(message: ScorelMessage): string | null {
  switch (message.role) {
    case "user":
      return message.content || null;
    case "assistant": {
      const text = message.content
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("\n")
        .trim();
      return text.length > 0 ? text : null;
    }
    case "toolResult": {
      const text = message.content.map((part) => part.text).join("\n").trim();
      if (text.length === 0) {
        return null;
      }
      return text.length > FTS_CONTENT_MAX_CHARS ? text.slice(0, FTS_CONTENT_MAX_CHARS) : text;
    }
    default:
      return null;
  }
}

function resolveProvider(
  providers: Map<string, ProviderEntry>,
  config: EmbeddingConfig,
): ProviderEntry | null {
  if (config.providerId) {
    const provider = providers.get(config.providerId) ?? null;
    return provider?.config.api === "openai-chat-completions" ? provider : null;
  }

  for (const provider of providers.values()) {
    if (provider.config.api === "openai-chat-completions") {
      return provider;
    }
  }

  return null;
}

async function embedTexts(
  provider: ProviderEntry,
  config: EmbeddingConfig,
  texts: string[],
): Promise<Float32Array[]> {
  const apiKey = await provider.getApiKey();
  if (!apiKey) {
    throw new Error(`No API key for embedding provider "${provider.config.id}"`);
  }

  const url = `${provider.config.baseUrl.replace(/\/$/, "")}/embeddings`;
  const embeddings: Float32Array[] = [];

  for (let index = 0; index < texts.length; index += EMBEDDING_BATCH_SIZE) {
    const batch = texts.slice(index, index + EMBEDDING_BATCH_SIZE);
    const response = await fetch(url, {
      method: "POST",
      headers: buildAuthHeaders(provider.config, apiKey),
      body: JSON.stringify({
        model: config.model,
        input: batch,
        dimensions: config.dimensions,
      }),
    });

    if (!response.ok) {
      const message = await response.text().catch(() => response.statusText);
      throw new Error(`Embedding request failed: ${response.status} ${message}`);
    }

    const data = await response.json() as {
      data?: Array<{ embedding?: number[] }>;
    };

    const batchEmbeddings = data.data?.map((item) => item.embedding ?? []) ?? [];
    if (batchEmbeddings.length !== batch.length) {
      throw new Error("Embedding provider returned an unexpected number of vectors");
    }

    for (const values of batchEmbeddings) {
      if (values.length !== config.dimensions) {
        throw new Error(`Embedding dimensions mismatch: expected ${config.dimensions}, got ${values.length}`);
      }
      embeddings.push(normalizeVector(new Float32Array(values)));
    }
  }

  return embeddings;
}

export class EmbeddingIndexer {
  private readonly db: Database.Database;
  private readonly getConfig: () => EmbeddingConfig;
  private readonly providers: Map<string, ProviderEntry>;
  private readonly queue: Job[] = [];
  private running = false;
  private readonly status: EmbeddingStatus;

  constructor(opts: {
    db: Database.Database;
    getConfig: () => EmbeddingConfig;
    providers: Map<string, ProviderEntry>;
  }) {
    this.db = opts.db;
    this.getConfig = opts.getConfig;
    this.providers = opts.providers;
    this.status = {
      state: "idle",
      pendingJobs: 0,
      activeJobs: 0,
      indexedCount: countActiveEmbeddings(opts.db),
      totalCount: null,
      lastError: null,
    };
  }

  getStatus(): EmbeddingStatus {
    return { ...this.status };
  }

  enqueueMessage(sessionId: string, message: ScorelMessage): void {
    if (!extractSearchableText(message)) {
      return;
    }
    this.queue.push({ kind: "message", sessionId, message });
    this.status.pendingJobs = this.queue.length;
    this.kick();
  }

  enqueueCompaction(compaction: CompactionRecord): void {
    if (!compaction.summaryText.trim()) {
      return;
    }
    this.queue.push({ kind: "compaction", compaction });
    this.status.pendingJobs = this.queue.length;
    this.kick();
  }

  async embedQuery(query: string, config = this.getConfig()): Promise<Float32Array> {
    const provider = resolveProvider(this.providers, config);
    if (!config.enabled || !provider) {
      throw new Error("No embedding provider configured");
    }

    const [vector] = await embedTexts(provider, config, [query.trim()]);
    if (!vector) {
      throw new Error("Embedding provider returned no query vector");
    }
    return vector;
  }

  async reindexAll(): Promise<EmbeddingStatus> {
    const messageJobs = listMessagesForReindex(this.db)
      .filter(({ message }) => extractSearchableText(message))
      .map<Job>(({ sessionId, message }) => ({ kind: "message", sessionId, message }));
    const compactionJobs = listCompactionsForReindex(this.db)
      .filter((compaction) => compaction.summaryText.trim().length > 0)
      .map<Job>((compaction) => ({ kind: "compaction", compaction }));

    this.queue.unshift(...messageJobs, ...compactionJobs);
    this.status.state = "reindexing";
    this.status.totalCount = messageJobs.length + compactionJobs.length;
    this.status.indexedCount = 0;
    this.status.pendingJobs = this.queue.length;
    this.status.lastError = null;
    this.kick();
    return this.getStatus();
  }

  private kick(): void {
    if (this.running) {
      return;
    }

    this.running = true;
    queueMicrotask(() => {
      void this.drain();
    });
  }

  private async drain(): Promise<void> {
    while (this.queue.length > 0) {
      const job = this.queue.shift()!;
      this.status.pendingJobs = this.queue.length;
      this.status.activeJobs = 1;
      if (this.status.state === "idle") {
        this.status.state = "indexing";
      }

      try {
        await this.processJob(job);
        if (this.status.totalCount != null) {
          this.status.indexedCount += 1;
        } else {
          this.status.indexedCount = countActiveEmbeddings(this.db);
        }
        this.status.lastError = null;
      } catch (error: unknown) {
        console.warn("Embedding job failed", error);
        this.status.lastError = error instanceof Error ? error.message : String(error);
        if (this.status.totalCount != null) {
          this.status.indexedCount += 1;
        }
      } finally {
        this.status.activeJobs = 0;
      }
    }

    if (this.status.totalCount != null) {
      this.status.indexedCount = this.status.totalCount;
      this.status.totalCount = null;
    } else {
      this.status.indexedCount = countActiveEmbeddings(this.db);
    }
    this.status.pendingJobs = 0;
    this.status.activeJobs = 0;
    this.status.state = "idle";
    this.running = false;
  }

  private async processJob(job: Job): Promise<void> {
    const config = this.getConfig();
    const provider = resolveProvider(this.providers, config);
    if (!config.enabled || !provider) {
      return;
    }

    const source = job.kind === "message"
      ? buildMessageSource(job.sessionId, job.message)
      : buildCompactionSource(job.compaction);
    if (!source) {
      return;
    }

    const chunks = chunkTextForEmbedding(source.text);
    const reusable = findReusableEmbeddings(
      this.db,
      config.model,
      config.dimensions,
      chunks.map((chunk) => chunk.hash),
    );
    const missingChunks = chunks.filter((chunk) => !reusable.has(chunk.hash));
    const embeddedChunks = new Map<string, Buffer>();

    if (missingChunks.length > 0) {
      const vectors = await embedTexts(provider, config, missingChunks.map((chunk) => chunk.text));
      for (const [index, chunk] of missingChunks.entries()) {
        const vector = vectors[index];
        if (!vector) {
          continue;
        }
        embeddedChunks.set(chunk.hash, vectorToBlob(vector));
      }
    }

    const rows: StoredEmbedding[] = chunks.map((chunk) => ({
      id: generateId(),
      sessionId: source.sessionId,
      sourceId: source.sourceId,
      sourceType: source.sourceType,
      targetMessageId: source.targetMessageId,
      chunkIndex: chunk.index,
      chunkText: chunk.text,
      tokenCount: chunk.tokenCount,
      model: config.model,
      dimensions: config.dimensions,
      vector: reusable.get(chunk.hash) ?? embeddedChunks.get(chunk.hash) ?? vectorToBlob(new Float32Array(config.dimensions)),
      hash: chunk.hash,
      createdAt: source.createdAt,
    }));

    const tx = this.db.transaction(() => {
      tombstoneEmbeddingsForSource(this.db, source.sourceType, source.sourceId);
      insertEmbeddings(this.db, rows);
    });
    tx();
  }
}

function buildMessageSource(sessionId: string, message: ScorelMessage): {
  sessionId: string;
  sourceId: string;
  sourceType: EmbeddingSourceType;
  targetMessageId: string;
  text: string;
  createdAt: number;
} | null {
  const text = extractSearchableText(message);
  if (!text) {
    return null;
  }

  return {
    sessionId,
    sourceId: message.id,
    sourceType: "message",
    targetMessageId: message.id,
    text,
    createdAt: message.ts,
  };
}

function buildCompactionSource(compaction: CompactionRecord): {
  sessionId: string;
  sourceId: string;
  sourceType: EmbeddingSourceType;
  targetMessageId: string;
  text: string;
  createdAt: number;
} | null {
  if (!compaction.summaryText.trim()) {
    return null;
  }

  return {
    sessionId: compaction.sessionId,
    sourceId: compaction.id,
    sourceType: "compaction",
    targetMessageId: compaction.boundaryMessageId,
    text: compaction.summaryText,
    createdAt: compaction.createdAt,
  };
}
