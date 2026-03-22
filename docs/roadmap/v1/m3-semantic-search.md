# V1-M3: Semantic Search

> Embedding pipeline + vector storage + ANN retrieval + hybrid FTS/vector ranking

## Goal

Upgrade Scorel from keyword-only search to semantic recall so users can find relevant prior conversations, decisions, and code snippets even when exact keywords don't match. After M3, search queries return results ranked by meaning, not just string overlap.

## Scope

### C1: Embedding Pipeline

**Problem**: FTS5 only finds exact keyword matches. A query like "authentication flow" won't surface a conversation about "login handler with JWT tokens" unless those exact words appear.

**Solution**: Generate embeddings for message content and store them for vector similarity search.

- **Embedding source**: user messages, assistant text parts, tool result content (first 2000 chars), compact summaries
- **Chunking**: split long content into overlapping chunks (max 512 tokens per chunk, 64-token overlap) to stay within embedding model context limits
- **Deduplication**: content hash per chunk; skip re-embedding if hash matches existing record
- **Provider**: configurable embedding model; default to OpenAI `text-embedding-3-small` (1536 dimensions); support any OpenAI-compatible embedding endpoint
- **Async processing**: embeddings generated in background after message persistence (not blocking the chat loop)
- **Batch API**: batch multiple chunks per API call (up to 2048 inputs per request for OpenAI)
- **Rate limiting**: respect provider rate limits; queue with backoff; embedding failure is non-fatal (log warning, skip)

### C2: Vector Storage

**Problem**: V0 reserved the `embeddings` table schema but left it unused. Need to populate it and add efficient vector retrieval.

**Solution**: Extend the reserved `embeddings` table and add an indexing strategy for approximate nearest neighbor search.

- **Storage**: use the existing `embeddings` table in SQLite (reserved in V0 `db.ts`)
- **Vector format**: `BLOB` column stores float32 array (1536 × 4 = 6144 bytes per vector for default model)
- **Index strategy**: for V1 scale (< 100k vectors), brute-force cosine similarity in SQL is acceptable; reserve `sqlite-vss` or `usearch` extension for V2 if needed
- **Lifecycle**: embeddings linked to source message via `source_id`; on message hard-delete, cascade delete embeddings; on soft-delete/archive, embeddings remain (for search across archived sessions)
- **Tombstone**: `tombstone` flag for soft-delete of stale embeddings (e.g., after re-embedding with updated model)

### C3: ANN Retrieval

**Problem**: Need to find the top-K most semantically similar chunks given a query.

**Solution**: Vector similarity search with configurable parameters.

- **Query embedding**: embed the search query using the same model/provider as corpus
- **Similarity metric**: cosine similarity (normalize vectors on insert; dot product at query time)
- **Top-K**: default K=20; configurable per query
- **Filters**: optional session_id filter (search within session), date range, role filter
- **Performance target**: < 500ms for 100k vectors on local SSD (brute-force scan is O(n) but fast at this scale with SQLite)
- **Fallback**: if embedding provider unavailable, degrade gracefully to FTS-only search

### C4: Hybrid Ranking

**Problem**: Neither FTS nor vector search alone is optimal. FTS excels at exact matches and rare terms; vector search excels at semantic similarity. Combining both produces the best results.

**Solution**: Reciprocal Rank Fusion (RRF) to merge FTS and vector results into a single ranked list.

- **Dual query**: execute FTS5 query and vector similarity query in parallel
- **RRF formula**: `score(d) = Σ 1/(k + rank_i(d))` where `k=60` (standard RRF constant) and `rank_i` is the rank in each result set
- **Deduplication**: merge by `message_id` (same message may appear in both FTS and vector results)
- **Result enrichment**: final `SearchResult` includes both FTS snippet (with highlights) and similarity score
- **UI**: search results display as unified ranked list; optionally show which signal (keyword/semantic) contributed

### C5: Embedding Configuration

**Problem**: Users may use different embedding providers or want to re-embed with a better model.

**Solution**: Embedding config in Settings with re-index capability.

- **Config**: `embedding.providerId`, `embedding.model`, `embedding.dimensions`, `embedding.enabled`
- **Shared provider**: reuse existing provider config (same base URL / API key) or configure a separate embedding provider
- **Re-index**: manual trigger to re-embed all existing messages with current model (background task with progress indicator)
- **Model change**: changing embedding model invalidates all existing vectors; prompt user to re-index or tombstone old embeddings

## Out of Scope (V1-M3)

- Dedicated vector database (Qdrant, Pinecone, etc.) (→ V2+; SQLite is sufficient for single-user scale)
- `sqlite-vss` / `usearch` native ANN index (→ V2 if brute-force too slow at scale)
- Cross-session semantic deduplication (→ V2)
- Image/multimodal embeddings (→ V2+)
- RAG-style automatic context injection (→ V2; M3 only exposes search, not auto-retrieval)
- Embedding cost estimation UI (→ V1 polish)

## Key Implementation Notes

### Embedding Pipeline Architecture

```
Message persisted (event-log + SQLite)
       │
       ▼
  EmbeddingQueue (in-memory, bounded)
       │
       ▼
  EmbeddingWorker (background)
       ├── chunk content (512 tokens, 64 overlap)
       ├── deduplicate by hash
       ├── batch embed via provider API
       ├── normalize vectors (L2 norm → unit vectors)
       └── write to embeddings table
```

### Chunk Strategy

```ts
type Chunk = {
  index: number;
  text: string;
  tokenCount: number;
  hash: string;              // SHA-256 of text content
};

function chunkContent(text: string, maxTokens = 512, overlap = 64): Chunk[] {
  const tokens = tokenize(text);
  const chunks: Chunk[] = [];
  let start = 0;

  while (start < tokens.length) {
    const end = Math.min(start + maxTokens, tokens.length);
    const chunkText = detokenize(tokens.slice(start, end));
    chunks.push({
      index: chunks.length,
      text: chunkText,
      tokenCount: end - start,
      hash: sha256(chunkText),
    });
    start += maxTokens - overlap;
    if (end === tokens.length) break;
  }

  return chunks;
}
```

### Embedding Provider Interface

```ts
type EmbeddingProvider = {
  embed(texts: string[]): Promise<EmbeddingResult>;
};

type EmbeddingResult = {
  embeddings: Float32Array[];   // one per input text
  model: string;
  usage: { promptTokens: number; totalTokens: number };
};

// OpenAI-compatible implementation
async function embedOpenAI(
  baseUrl: string,
  apiKey: string,
  model: string,
  texts: string[],
): Promise<EmbeddingResult> {
  const response = await fetch(`${baseUrl}/embeddings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, input: texts }),
  });
  const data = await response.json();
  return {
    embeddings: data.data.map((d: { embedding: number[] }) => new Float32Array(d.embedding)),
    model: data.model,
    usage: { promptTokens: data.usage.prompt_tokens, totalTokens: data.usage.total_tokens },
  };
}
```

### Vector Operations (SQLite)

```ts
// Store normalized vector as BLOB
function vectorToBlob(v: Float32Array): Buffer {
  return Buffer.from(v.buffer, v.byteOffset, v.byteLength);
}

function blobToVector(blob: Buffer): Float32Array {
  return new Float32Array(blob.buffer, blob.byteOffset, blob.byteLength / 4);
}

// Cosine similarity (vectors pre-normalized → dot product)
function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
  }
  return dot;
}
```

### Brute-Force ANN Query

```ts
async function vectorSearch(
  db: Database,
  queryVector: Float32Array,
  options: { topK?: number; sessionId?: string; minScore?: number },
): Promise<VectorSearchResult[]> {
  const { topK = 20, sessionId, minScore = 0.3 } = options;

  // Load all vectors (or filtered by session)
  let sql = `SELECT id, source_id, chunk_index, vector FROM embeddings WHERE tombstone = 0`;
  const params: unknown[] = [];
  if (sessionId) {
    sql += ` AND session_id = ?`;
    params.push(sessionId);
  }

  const rows = db.prepare(sql).all(...params);

  // Compute similarities
  const scored = rows.map((row) => ({
    id: row.id,
    sourceId: row.source_id,
    chunkIndex: row.chunk_index,
    score: cosineSimilarity(queryVector, blobToVector(row.vector)),
  }));

  // Filter and sort
  return scored
    .filter((r) => r.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}
```

### Hybrid Search (RRF)

```ts
type HybridSearchResult = {
  messageId: string;
  sessionId: string;
  sessionTitle: string;
  role: string;
  snippet: string;            // FTS highlight snippet
  similarityScore?: number;   // vector similarity (if matched)
  ftsRank?: number;           // FTS rank (if matched)
  rrfScore: number;           // combined RRF score
  ts: number;
  seq: number;
};

function reciprocalRankFusion(
  ftsResults: SearchResult[],
  vectorResults: VectorSearchResult[],
  k = 60,
): HybridSearchResult[] {
  const scores = new Map<string, { ftsRank?: number; vecRank?: number; data: Partial<HybridSearchResult> }>();

  // Assign FTS ranks
  ftsResults.forEach((r, i) => {
    scores.set(r.messageId, {
      ftsRank: i + 1,
      data: { messageId: r.messageId, sessionId: r.sessionId, sessionTitle: r.sessionTitle,
              role: r.role, snippet: r.snippet, ts: r.ts, seq: r.seq },
    });
  });

  // Assign vector ranks (resolve sourceId → messageId)
  vectorResults.forEach((r, i) => {
    const existing = scores.get(r.sourceId) ?? { data: { messageId: r.sourceId } };
    existing.vecRank = i + 1;
    existing.data.similarityScore = r.score;
    scores.set(r.sourceId, existing);
  });

  // Compute RRF
  return Array.from(scores.entries()).map(([msgId, entry]) => {
    let rrfScore = 0;
    if (entry.ftsRank) rrfScore += 1 / (k + entry.ftsRank);
    if (entry.vecRank) rrfScore += 1 / (k + entry.vecRank);
    return { ...entry.data, ftsRank: entry.ftsRank, rrfScore } as HybridSearchResult;
  }).sort((a, b) => b.rrfScore - a.rrfScore);
}
```

### Embeddings Table (reserved in V0, extended)

The table already exists in `db.ts`. V1 adds an index and uses the existing columns:

```sql
-- Already created in V0:
-- CREATE TABLE IF NOT EXISTS embeddings (
--   id TEXT PRIMARY KEY,
--   session_id TEXT NOT NULL,
--   source_id TEXT NOT NULL,
--   chunk_index INTEGER NOT NULL,
--   model TEXT NOT NULL,
--   vector BLOB NOT NULL,
--   hash TEXT NOT NULL,
--   tombstone INTEGER NOT NULL DEFAULT 0,
--   created_at INTEGER NOT NULL
-- );

-- V1 additions:
CREATE INDEX IF NOT EXISTS idx_embeddings_session ON embeddings(session_id);
CREATE INDEX IF NOT EXISTS idx_embeddings_source ON embeddings(source_id);
CREATE INDEX IF NOT EXISTS idx_embeddings_hash ON embeddings(hash);
```

### Embedding Config

```ts
type EmbeddingConfig = {
  enabled: boolean;
  providerId: string;          // references providers table (reuse or dedicated)
  model: string;               // e.g. "text-embedding-3-small"
  dimensions: number;          // e.g. 1536
  chunkMaxTokens: number;      // default 512
  chunkOverlap: number;        // default 64
};
```

## Acceptance Criteria

- [ ] Embedding pipeline: new message → background embedding → stored in embeddings table (non-blocking)
- [ ] Chunking: long message (10k tokens) → multiple chunks with correct overlap
- [ ] Deduplication: identical content re-sent → no duplicate embeddings (hash check)
- [ ] Vector search: query "authentication" finds messages about "login handler" (semantic match, not keyword)
- [ ] Hybrid search: query with both exact keyword and semantic matches → RRF-ranked unified results
- [ ] FTS fallback: embedding provider unavailable → search degrades to FTS-only, no error
- [ ] Performance: < 500ms for vector search across 100k embeddings on local SSD
- [ ] Re-index: change embedding model → re-embed all messages (background task with progress)
- [ ] Tombstone: old embeddings tombstoned after model change; not included in search
- [ ] Settings UI: embedding config (enable/disable, model selection, re-index trigger)
- [ ] Search UI: unified results display; works identically to V0 FTS from user perspective but with better recall

## Files to Create/Modify

| File | Action |
|------|--------|
| `src/main/embeddings/embedding-worker.ts` | Create: background embedding pipeline (queue, batch, write) |
| `src/main/embeddings/chunker.ts` | Create: text chunking with overlap |
| `src/main/embeddings/embedding-provider.ts` | Create: OpenAI-compatible embedding API client |
| `src/main/embeddings/vector-search.ts` | Create: brute-force cosine similarity search |
| `src/main/embeddings/hybrid-search.ts` | Create: RRF fusion of FTS + vector results |
| `src/main/embeddings/types.ts` | Create: Chunk, EmbeddingResult, VectorSearchResult, EmbeddingConfig types |
| `src/main/storage/db.ts` | Modify: add indexes on embeddings table |
| `src/main/storage/event-log.ts` | Modify: hook embedding queue on message write |
| `src/main/core/session-manager.ts` | Modify: integrate hybrid search into search API |
| `src/shared/types.ts` | Modify: add EmbeddingConfig, HybridSearchResult types |
| `src/shared/events.ts` | Modify: add `embedding.progress`, `embedding.error` event types |
| `src/renderer/components/SettingsView.tsx` | Modify: add embedding configuration section |
| `src/renderer/components/SearchResults.tsx` | Modify: display hybrid results with relevance indicators |
| `src/preload/index.ts` | Modify: add embeddings.* IPC (config, re-index, search) |

## Definition of Done

Search finds relevant results by meaning, not just keywords. Embeddings are generated transparently in the background without blocking chat. Hybrid ranking combines FTS precision with vector recall. The system degrades gracefully when embedding provider is unavailable.
