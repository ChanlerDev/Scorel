# V1-M3 Semantic Search Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add configurable background embeddings, brute-force vector retrieval, and hybrid FTS plus semantic ranking so history search can recall semantically related messages without blocking the chat loop.

**Architecture:** Keep SQLite as the system of record. Add an in-process embedding indexer that asynchronously chunks persisted content, reuses vectors by hash, and writes normalized vectors into the existing `embeddings` table with richer metadata. Replace pure FTS search with an async hybrid search service that runs FTS and vector retrieval together, degrades cleanly when embeddings are unavailable, and exposes embedding config plus re-index controls through Settings.

**Tech Stack:** TypeScript strict, Electron IPC, better-sqlite3, existing provider/keychain stack, Vitest

---

## Chunk 1: Config + Search Storage Contract

### Task 1: Define semantic search config and result types

**Files:**
- Modify: `src/main/app-config.ts`
- Modify: `src/shared/types.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/global.d.ts`
- Test: `tests/unit/app-config.test.ts`

- [ ] **Step 1:** Add `embedding` config to `AppConfig` with defaults and normalization.

Shape:
```ts
type EmbeddingConfig = {
  enabled: boolean;
  providerId: string | null;
  model: string;
  dimensions: number;
};
```

Defaults:
- `enabled: true`
- `providerId: null`
- `model: "text-embedding-3-small"`
- `dimensions: 1536`

Normalization rules:
- empty provider → `null`
- blank model → default model
- dimensions must be positive integer, fallback to `1536`

- [ ] **Step 2:** Extend shared types for hybrid search and embedding settings/status.

Add:
- `EmbeddingConfig`
- `EmbeddingStatus`
- `SearchResult` enrichment fields needed by UI and ranking:
  - `snippetSource: "fts" | "semantic"`
  - `signals: Array<"keyword" | "semantic">`
  - `similarityScore?: number`
  - `rrfScore: number`

- [ ] **Step 3:** Extend preload and renderer bridge with:
- `search.query(...)` returning async hybrid results
- `search.getEmbeddingConfig()`
- `search.saveEmbeddingConfig(config)`
- `search.getEmbeddingStatus()`
- `search.reindexAll()`

- [ ] **Step 4:** Add app-config tests covering default embedding config and normalization.

- [ ] **Step 5:** Run targeted tests: `pnpm test -- tests/unit/app-config.test.ts`

---

## Chunk 2: DB Migration + Failing Search Tests

### Task 2: Lock the storage and ranking contract with failing tests first

**Files:**
- Modify: `tests/unit/search.test.ts`
- Modify: `tests/unit/compact.test.ts`
- Modify: `src/main/storage/db.ts`

- [ ] **Step 1:** Expand `tests/unit/search.test.ts` with failing tests for:
1. vector-only semantic match returns a result when FTS misses
2. RRF merges FTS and vector hits and preserves both signals
3. FTS-only fallback still works when embeddings are disabled or provider unavailable
4. session filter still applies to vector retrieval
5. duplicate vector chunks for the same message collapse to one result

- [ ] **Step 2:** Expand `tests/unit/compact.test.ts` with a failing test proving compaction summaries can be indexed and surfaced through semantic search while navigating to the boundary message.

- [ ] **Step 3:** Implement only the schema changes required to make the tests compile, without making them pass yet.

Migration target:
- bump DB user version
- extend `embeddings` table with:
  - `source_type TEXT NOT NULL DEFAULT 'message'`
  - `target_message_id TEXT NOT NULL`
  - `chunk_text TEXT NOT NULL`
  - `token_count INTEGER NOT NULL DEFAULT 0`
  - `dimensions INTEGER NOT NULL DEFAULT 1536`
- add indexes for `(model, tombstone)` and `(source_type, source_id, tombstone)`

- [ ] **Step 4:** Run the targeted tests and confirm they fail for the intended missing semantic behavior.

Run:
```bash
pnpm test -- tests/unit/search.test.ts tests/unit/compact.test.ts
```

Expected:
- hybrid/semantic tests fail
- existing keyword-only tests still pass or fail only where the contract changed intentionally

---

## Chunk 3: Embedding Utilities + Indexer

### Task 3: Build the async embedding pipeline

**Files:**
- Create: `src/main/search/embedding-service.ts`
- Create: `src/main/search/embedding-indexer.ts`
- Modify: `src/main/core/session-manager.ts`
- Modify: `src/main/core/orchestrator.ts`
- Modify: `src/main/index.ts`
- Test: `tests/unit/search.test.ts`

- [ ] **Step 1:** Add embedding utility functions in `embedding-service.ts`:
- chunk long text by approximate token windows (`512` max, `64` overlap)
- hash chunks with SHA-256
- normalize vectors to unit length
- convert vector blob to and from `Buffer`
- build snippet text for semantic-only hits

- [ ] **Step 2:** Add OpenAI-compatible embedding client:
- resolve provider config and secret
- POST to `/embeddings`
- batch up to `2048` inputs
- validate dimensions
- return `Float32Array[]`

- [ ] **Step 3:** Add `EmbeddingIndexer`:
- bounded in-memory queue
- schedule message and compaction jobs after persistence
- process jobs asynchronously
- reuse vectors by `(model, dimensions, hash)` when present
- tombstone stale rows for the same source on re-embed
- track live status for UI and reindex progress

- [ ] **Step 4:** Wire `SessionManager.appendMessage()` to enqueue persisted messages and `Orchestrator.manualCompact()` to enqueue compact summaries.

- [ ] **Step 5:** Add or update tests for chunking overlap, dedup reuse, and non-fatal provider failure behavior.

- [ ] **Step 6:** Run targeted tests: `pnpm test -- tests/unit/search.test.ts`

---

## Chunk 4: Hybrid Search Retrieval

### Task 4: Replace pure FTS search with async hybrid search

**Files:**
- Modify: `src/main/storage/db.ts`
- Modify: `src/main/ipc-handlers.ts`
- Test: `tests/unit/search.test.ts`

- [ ] **Step 1:** Keep a pure FTS helper in `db.ts` and add DB helpers for:
- listing candidate embeddings with optional session filter
- inserting/replacing embeddings
- tombstoning embeddings by source or model
- reading compaction metadata needed to navigate semantic summary hits

- [ ] **Step 2:** Add async hybrid search flow:
1. run FTS query
2. if embeddings enabled and provider resolvable, embed the query
3. compute brute-force cosine similarity over active vectors for the active embedding model
4. convert vector hits to message-level records
5. fuse FTS and vector results with RRF (`k = 60`)
6. clamp final limit and preserve deterministic ordering

- [ ] **Step 3:** Make fallback explicit:
- query embedding failure logs warning and returns FTS-only results
- disabled or unsupported provider returns FTS-only results without throwing

- [ ] **Step 4:** Re-run search and compact tests until green.

Run:
```bash
pnpm test -- tests/unit/search.test.ts tests/unit/compact.test.ts
```

---

## Chunk 5: Settings + UX

### Task 5: Expose semantic search controls in Settings and search UI

**Files:**
- Modify: `src/renderer/components/SettingsView.tsx`
- Modify: `src/renderer/App.tsx`
- Modify: `tests/unit/settings-view.test.ts`

- [ ] **Step 1:** Add Settings helpers and UI for:
- enable/disable embeddings
- choose provider or auto mode
- choose model and dimensions
- trigger full re-index
- show queue/re-index status text

- [ ] **Step 2:** On config save, if model/provider/dimensions changed and active embeddings exist, prompt to re-index now.

- [ ] **Step 3:** Update sidebar search results to display signal provenance compactly, without breaking existing snippet highlighting.

- [ ] **Step 4:** Add lightweight tests for any new exported Settings helpers or messaging.

- [ ] **Step 5:** Run targeted UI tests:
```bash
pnpm test -- tests/unit/settings-view.test.ts
```

---

## Chunk 6: Final Verification

### Task 6: Verify the implementation end to end

**Files:**
- Modify only as needed from failures discovered here

- [ ] **Step 1:** Run the full unit test suite.

```bash
pnpm test
```

- [ ] **Step 2:** Run lint.

```bash
pnpm lint
```

- [ ] **Step 3:** Run build.

```bash
pnpm build
```

- [ ] **Step 4:** Perform a final code review pass against `docs/roadmap/v1/m3-semantic-search.md` and confirm the shipped scope matches the roadmap without sneaking in V2 work.

- [ ] **Step 5:** Summarize remaining gaps, if any, before handoff.
