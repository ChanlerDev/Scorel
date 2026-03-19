# V0-M3: History & Search

> SQLite schema finalization + FTS5 + export JSONL/MD

## Goal

Complete the persistence layer: full schema with all tables, full-text search, session export in two formats.

## Scope

- **SQLite schema finalization**: all tables (providers, sessions, events, messages, compactions, embeddings placeholder)
- **FTS5 search**: synchronous index on message insert; keyword search across sessions
- **SearchResult type**: snippet, highlight, session context
- **Export JSONL**: full message_json (not micro_compacted), session metadata header
- **Export Markdown**: human-readable format with tool call blockquotes
- **Session archive**: soft archive via `sessions.archived` flag
- **Session delete**: soft delete → confirm → hard delete (cascade messages, events, FTS, compactions)

## Key Implementation Notes

### SearchResult Shape

```ts
type SearchResult = {
  messageId: string;
  sessionId: string;
  sessionTitle: string;
  role: string;
  snippet: string;       // FTS snippet with match highlights
  ts: number;
  seq: number;
};
```

### FTS5 Sync

- Written synchronously in same transaction as message insert
- Indexed: user text, assistant text parts (joined), tool result content (first 2000 chars)
- On manual compact: summary gets new FTS entry; old entries preserved
- FTS rebuild available as debug command

### Export

- JSONL: `message_json` from messages table (full canonical, not micro_compacted)
- Markdown: tool results truncated to 500 chars; full output in JSONL only
- Redacted export mode: mask `sk-*`, `Bearer *`, home paths

## Acceptance Criteria

- [ ] FTS search at 10k message scale: keyword query < 200ms (local SSD)
- [ ] Export JSONL: re-importable (valid JSON per line, correct schema version)
- [ ] Export Markdown: human-readable, tool calls shown as blockquotes
- [ ] Archive/unarchive works; archived sessions excluded from default list
- [ ] Delete cascades correctly (messages, events, FTS entries, compactions)

## Files to Create/Modify

| File | Action |
|------|--------|
| `src/main/storage/db.ts` | Modify: finalize schema, add migrations |
| `src/main/storage/migrations/` | Create: versioned migration scripts |
| `src/main/core/session-manager.ts` | Modify: add archive, delete, export |
| `src/preload/index.ts` | Modify: add search.query |
| `src/renderer/` | Modify: search UI, export buttons |

## Definition of Done

Search works fast at scale. Export produces valid, usable files. Archive/delete lifecycle complete.
