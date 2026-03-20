import type Database from "better-sqlite3";
import type { CompactionRecord } from "../../shared/types.js";

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

function rowToCompaction(row: CompactionRow): CompactionRecord {
  return {
    id: row.id,
    sessionId: row.session_id,
    boundaryMessageId: row.boundary_message_id,
    summaryText: row.summary_text,
    providerId: row.provider_id,
    modelId: row.model_id,
    transcriptPath: row.transcript_path,
    createdAt: row.created_at,
  };
}

export function insertCompaction(
  db: Database.Database,
  record: CompactionRecord,
): void {
  db.prepare(
    `INSERT INTO compactions (
       id,
       session_id,
       boundary_message_id,
       summary_text,
       provider_id,
       model_id,
       transcript_path,
       created_at
     ) VALUES (
       @id,
       @sessionId,
       @boundaryMessageId,
       @summaryText,
       @providerId,
       @modelId,
       @transcriptPath,
       @createdAt
     )`,
  ).run(record);
}

export function getCompaction(
  db: Database.Database,
  compactionId: string,
): CompactionRecord | null {
  const row = db.prepare(
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
     WHERE id = ?`,
  ).get(compactionId) as CompactionRow | undefined;

  return row ? rowToCompaction(row) : null;
}

export function listCompactions(
  db: Database.Database,
  sessionId: string,
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
     WHERE session_id = ?
     ORDER BY created_at DESC`,
  ).all(sessionId) as CompactionRow[];

  return rows.map(rowToCompaction);
}

export function updateSessionCompact(
  db: Database.Database,
  sessionId: string,
  compactId: string | null,
): void {
  db.prepare(
    "UPDATE sessions SET active_compact_id = ?, updated_at = ? WHERE id = ?",
  ).run(compactId, Date.now(), sessionId);
}
