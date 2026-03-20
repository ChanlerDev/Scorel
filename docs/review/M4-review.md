# M4 Compact & Skills — Implementation Review

> Reviewer: Claude | All 60 unit tests passing

## R1 Issue Tracker

| # | Priority | Issue | Status |
|---|----------|-------|--------|
| 1 | P0 | `applyBoundaryResume` seq-as-index | **Fixed** — uses `getMessages(sessionId, boundarySeq)` + sparse seq test |
| 2 | P1 | `load_skill` description "reserved for M4" | **Fixed** — updated text |
| 3 | P1 | `manualCompact` double write `active_compact_id` | **Fixed** — `executeManualCompact` only inserts compaction |
| 4 | P1 | `generateId()` duplicated in 3 files | **Fixed** — extracted to `src/main/core/id.ts` |
| 5 | P2 | `trimSerializedMessages` truncation lacks comment | **Fixed** — comment added |
| 6 | P2 | `COMPACT_SUMMARY_PROMPT` naive string replace | **Fixed** — `buildCompactSummaryPrompt` uses template literal |
| 7 | P2 | Compactions table lacks FK constraints | Open — acceptable for V0 |
| 8 | P2 | `includeLoadSkill` defaults to `true` | Open — harmless, orchestrator always passes explicitly |
| 9 | P3 | `tools` bridge type missing from `global.d.ts` | Open — pre-existing, not M4 |
| 10 | P3 | Test coverage gaps | **Mostly fixed** — 10-turn, unknown skill, compact failure, FTS tests added |

---

## R2 — New Findings

### P1 — No-runner guard drops load_skill results in mixed tool call batches

**File**: `src/main/core/orchestrator.ts:207-210`

```ts
if (!this.toolRunner && toolCalls.some((toolCall) => toolCall.name !== "load_skill")) {
  this.sessionManager.setState(sessionId, "idle");
  return;
}
```

**Problem**: When there is no tool runner and the model requests BOTH `load_skill` and a runner tool (e.g. `[load_skill, bash]`), the guard bails out entirely. No tool results are produced — not even the `load_skill` result which could execute without a runner. The model gets stuck with a dangling `toolUse` assistant message and no feedback.

Truth table:

| Tool calls | Current `some(!= load_skill)` | Expected behavior |
|---|---|---|
| `[bash]` | bail — correct | bail (nothing can execute) |
| `[load_skill]` | proceed — correct | proceed |
| `[load_skill, bash]` | **bail — BUG** | proceed (execute load_skill, error on bash) |
| `[bash, read_file]` | bail — correct | bail (nothing can execute) |

**Fix**: Change the condition to only bail when there are NO load_skill calls at all:

```ts
const hasSkillCalls = toolCalls.some((toolCall) => toolCall.name === "load_skill");
if (!this.toolRunner && !hasSkillCalls) {
  this.sessionManager.setState(sessionId, "idle");
  return;
}
```

This way, `[load_skill, bash]` proceeds to `executeToolCalls` where:
- `load_skill` executes in Core — success
- `bash` with no runner — returns error ToolResult (`"Tool runner unavailable for bash"`)
- Both results are fed back to the model — correct

The existing test "without toolRunner, tool call assistant is persisted but no execution" (`tool-execution.test.ts:285`) would NOT break because it uses `[bash]` only (no load_skill), so `hasSkillCalls = false` → bail unchanged.

---

### P2 — `modelLoop` reads all messages from DB twice per iteration

**File**: `src/main/core/orchestrator.ts:127-129`

```ts
const session = this.sessionManager.get(sessionId)!;       // reads session + ALL messages
const messages = this.getContextMessages(sessionId, session); // reads ALL messages again
```

`SessionManager.get()` calls `dbGetSessionDetail` + `dbGetMessages` to build the full `SessionDetail` (including `messages` array). Then `getContextMessages()` calls `getMessages()` again for context assembly. The `session.messages` from `get()` is never used for context — only `session.activeCompactId` and other metadata are needed.

In a 10-round tool loop (20+ messages), this means reading the messages table 20+ extra times.

**Fix**: Split `get()` into two paths, or add a lightweight `getSessionMeta()` that returns only metadata (no messages). `getContextMessages` already fetches the messages it needs:

```ts
// Option: add getSessionMeta to SessionManager
getSessionMeta(sessionId: string): Omit<SessionDetail, "messages"> | null

// Then in modelLoop:
const session = this.sessionManager.getSessionMeta(sessionId)!;
const messages = this.getContextMessages(sessionId, session);
```

Not a bug, but a performance improvement for long sessions.

---

### P2 — `saveCompactTranscript` uses array index instead of DB seq

**File**: `src/main/core/compact.ts:217-222`

```ts
...messages.map((message, index) => JSON.stringify({
  v: COMPACT_TRANSCRIPT_VERSION,
  type: "message",
  seq: index + 1,   // ← array position, not DB seq
  message,
})),
```

For the sparse seq test case (DB seq: 10, 20, 30), the transcript would record `seq: 1, 2, 3` instead of `10, 20, 30`. Since `ScorelMessage` doesn't carry `seq` (it's a DB-level concern), this is hard to fix without changing the function signature.

**Suggestion**: Accept `Array<{ seq: number; message: ScorelMessage }>` instead of `ScorelMessage[]`, or document that transcript seq values are positional, not DB-authoritative.

---

### P3 — `parseFrontmatter` regex doesn't handle CRLF line endings

**File**: `src/main/skills/skill-loader.ts:5`

```ts
const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?/;
```

Uses `\n` only. SKILL.md files with Windows-style `\r\n` line endings would fail to match. Since the project is macOS-only and skills are bundled with the app, this is very low risk. But if skills are ever git-cloned from a Windows repo without `.gitattributes`, they'll silently fail to parse.

**Fix** (if desired):

```ts
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
```

---

### P3 — FTS test title misleading

**File**: `tests/unit/compact.test.ts:250`

```ts
it("search keeps finding pre-compact content after a compaction record exists", () => {
```

The test does NOT create a compaction record. It inserts messages and searches them. The invariant being tested (messages table is never mutated) is correct, but the title implies a compaction was created. Consider either creating an actual compaction in the test setup, or renaming to "search finds content because compaction never deletes messages".

---

## Summary

### R1 resolution: 6/10 fixed, 4 open (all acceptable for V0)

### R2 new findings:

| # | Priority | Issue | Effort |
|---|----------|-------|--------|
| R2-1 | P1 | No-runner guard drops load_skill in mixed batches | Small — one condition change |
| R2-2 | P2 | `modelLoop` double DB read per iteration | Medium — needs `getSessionMeta()` |
| R2-3 | P2 | Transcript seq uses array index, not DB seq | Small — signature change or docs |
| R2-4 | P3 | Frontmatter regex ignores CRLF | Trivial |
| R2-5 | P3 | FTS test title misleading | Trivial |
