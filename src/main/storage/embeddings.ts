import Database from "better-sqlite3";
import type { CompactionRecord, ScorelMessage } from "../../shared/types.js";

export type EmbeddingSourceType = "message" | "compaction";

export type StoredEmbedding = {
  id: string;
  sessionId: string;
  sourceId: string;
  sourceType: EmbeddingSourceType;
  targetMessageId: string;
  chunkIndex: number;
  chunkText: string;
  tokenCount: number;
  model: string;
  dimensions: number;
  vector: Buffer;
  hash: string;
  createdAt: number;
};

type ReusableEmbeddingRow = {
  hash: string;
  vector: Buffer;
};

type MessageRow = {
  session_id: string;
  message_json: string;
};

type CompactionRow = {
  id: string;
  session_id: string;
  boundary_message_id: string;
  summary_text: string;
  provider_id: string;
  model_id: string;
  transcript_path: string | null;
  created_at: number;
};

export function insertEmbeddings(
  db: Database.Database,
  rows: StoredEmbedding[],
): void {
  if (rows.length === 0) {
    return;
  }

  const insert = db.prepare(
    `INSERT INTO embeddings (
       id,
       session_id,
       source_id,
       source_type,
       target_message_id,
       chunk_index,
       chunk_text,
       token_count,
       model,
       dimensions,
       vector,
       hash,
       tombstone,
       created_at
     ) VALUES (
       @id,
       @sessionId,
       @sourceId,
       @sourceType,
       @targetMessageId,
       @chunkIndex,
       @chunkText,
       @tokenCount,
       @model,
       @dimensions,
       @vector,
       @hash,
       0,
       @createdAt
     )`,
  );

  const tx = db.transaction((nextRows: StoredEmbedding[]) => {
    for (const row of nextRows) {
      insert.run(row);
    }
  });
  tx(rows);
}

export function tombstoneEmbeddingsForSource(
  db: Database.Database,
  sourceType: EmbeddingSourceType,
  sourceId: string,
): void {
  db.prepare(
    `UPDATE embeddings
     SET tombstone = 1
     WHERE source_type = ? AND source_id = ? AND tombstone = 0`,
  ).run(sourceType, sourceId);
}

export function findReusableEmbeddings(
  db: Database.Database,
  model: string,
  dimensions: number,
  hashes: string[],
): Map<string, Buffer> {
  if (hashes.length === 0) {
    return new Map();
  }

  const placeholders = hashes.map(() => "?").join(", ");
  const rows = db.prepare(
    `SELECT hash, vector
     FROM embeddings
     WHERE model = ?
       AND dimensions = ?
       AND tombstone = 0
       AND hash IN (${placeholders})
     GROUP BY hash`,
  ).all(model, dimensions, ...hashes) as ReusableEmbeddingRow[];

  return new Map(rows.map((row) => [row.hash, row.vector] as const));
}

export function countActiveEmbeddings(
  db: Database.Database,
  opts?: { model?: string; dimensions?: number },
): number {
  const row = db.prepare(
    `SELECT COUNT(*) AS count
     FROM embeddings
     WHERE tombstone = 0
       AND (? IS NULL OR model = ?)
       AND (? IS NULL OR dimensions = ?)`,
  ).get(
    opts?.model ?? null,
    opts?.model ?? null,
    opts?.dimensions ?? null,
    opts?.dimensions ?? null,
  ) as { count: number } | undefined;

  return row?.count ?? 0;
}

export function listMessagesForReindex(
  db: Database.Database,
): Array<{ sessionId: string; message: ScorelMessage }> {
  const rows = db.prepare(
    `SELECT session_id, message_json
     FROM messages
     ORDER BY ts ASC, seq ASC`,
  ).all() as MessageRow[];

  return rows.map((row) => ({
    sessionId: row.session_id,
    message: JSON.parse(row.message_json) as ScorelMessage,
  }));
}

export function listCompactionsForReindex(
  db: Database.Database,
): CompactionRecord[] {
  const rows = db.prepare(
    `SELECT
       id,
       session_id,
       boundary_message_id,
       summary_text,
       provider_id,
       model_id,
       transcript_path,
       created_at
     FROM compactions
     ORDER BY created_at ASC`,
  ).all() as CompactionRow[];

  return rows.map((row) => ({
    id: row.id,
    sessionId: row.session_id,
    boundaryMessageId: row.boundary_message_id,
    summaryText: row.summary_text,
    providerId: row.provider_id,
    modelId: row.model_id,
    transcriptPath: row.transcript_path,
    createdAt: row.created_at,
  }));
}
