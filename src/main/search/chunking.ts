import { createHash } from "node:crypto";

export type EmbeddingChunk = {
  index: number;
  text: string;
  tokenCount: number;
  hash: string;
};

const MAX_CHUNK_CHARS = 2048;
const CHUNK_OVERLAP_CHARS = 256;

function sliceUnicodeChars(text: string, start: number, end: number): string {
  return Array.from(text).slice(start, end).join("");
}

export function chunkTextForEmbedding(text: string): EmbeddingChunk[] {
  const charCount = Array.from(text).length;
  if (charCount === 0) {
    return [];
  }

  const chunks: EmbeddingChunk[] = [];
  let start = 0;

  while (start < charCount) {
    const end = Math.min(start + MAX_CHUNK_CHARS, charCount);
    const chunk = sliceUnicodeChars(text, start, end);
    chunks.push({
      index: chunks.length,
      text: chunk,
      tokenCount: end - start,
      hash: createHash("sha256").update(chunk).digest("hex"),
    });

    if (end === charCount) {
      break;
    }
    start += MAX_CHUNK_CHARS - CHUNK_OVERLAP_CHARS;
  }

  return chunks;
}
