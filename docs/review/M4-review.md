# M4 Compact & Skills — Implementation Review

> Reviewer: Claude | Date: 2025-03-21 | All 54 unit tests passing

## P0 — Bug (must fix)

### 1. `applyBoundaryResume` uses seq value as array index

**File**: `src/main/core/compact.ts:201`

```ts
return [makeCompactSummaryMessage(compaction), ...messages.slice(boundarySeq)];
```

`boundarySeq` is a DB `seq` value (1-based monotonic), but `messages.slice(boundarySeq)` treats it as an array index. This happens to produce correct results in V0 (seq = index + 1, so `slice(seq)` is equivalent to `filter(m => m.seq > seq)`), but the equality depends on:

- seq starting at 1 with no gaps
- `getMessages()` returning the full list

If messages are ever deleted or seqs have gaps, this will **silently return the wrong context slice**.

**Fix**: Use `getMessages(sessionId, boundarySeq)` in `getContextMessages` instead of fetching all messages and then slicing. The `afterSeq` parameter already exists on `getMessages`. This eliminates the need for `applyBoundaryResume` to slice at all — just prepend the summary message.

```ts
// orchestrator.ts — getContextMessages
private getContextMessages(sessionId: string, session: SessionDetail): ScorelMessage[] {
  if (session.activeCompactId) {
    const compaction = getCompaction(this.db, session.activeCompactId);
    if (compaction) {
      const boundarySeq = this.sessionManager.getMessageSeq(
        sessionId, compaction.boundaryMessageId,
      );
      if (boundarySeq != null) {
        const postBoundary = this.sessionManager.getMessages(sessionId, boundarySeq);
        const messages = [makeCompactSummaryMessage(compaction), ...postBoundary];
        return applyMicroCompact(messages, MICRO_COMPACT_KEEP_RECENT);
      }
    }
  }

  return applyMicroCompact(
    this.sessionManager.getMessages(sessionId),
    MICRO_COMPACT_KEEP_RECENT,
  );
}
```

After this change, `applyBoundaryResume` can be removed (or kept as a thin wrapper if tests depend on it).

---

## P1 — Design / correctness (should fix)

### 2. `load_skill` tool description still says "reserved for M4"

**File**: `src/main/core/tool-dispatch.ts:110`

```ts
case "load_skill":
  return "Load a skill file (reserved for M4).";
```

This description is sent to the LLM as part of the tool schema. The model may interpret "reserved" as "not yet available" and refuse to call it.

**Fix**: Update to match the design doc:

```ts
case "load_skill":
  return "Load a skill file to get detailed instructions for a specific task. Use 'list' as the name to see available skills.";
```

### 3. `manualCompact` writes `active_compact_id` twice

**File**: `src/main/core/orchestrator.ts:389`

```ts
const result = await executeManualCompact({...});
// executeManualCompact internally calls updateSessionCompact (compact.ts:298)
this.sessionManager.setActiveCompact(sessionId, result.compactionId); // writes again
```

`executeManualCompact` already calls `updateSessionCompact` inside its transaction (`compact.ts:296-300`). The orchestrator then calls `setActiveCompact` again — same value, redundant DB write, and misleading (implies `executeManualCompact` didn't handle it).

**Fix** (pick one):

- **(a) Remove from orchestrator**: Delete line 389. `executeManualCompact` already handles it.
- **(b) Remove from `executeManualCompact`**: Move `updateSessionCompact` out of the transaction in `compact.ts`, let orchestrator own it. This gives orchestrator full control over session state, which is more consistent with the rest of the codebase.

Option (b) is cleaner architecturally — `executeManualCompact` would only `insertCompaction`, and orchestrator would `setActiveCompact` after success. The transaction in `compact.ts` would only contain `insertCompaction`.

### 4. `generateId()` duplicated in three files

**Files**:
- `src/main/core/orchestrator.ts:36-38`
- `src/main/core/session-manager.ts:28-30`
- `src/main/core/compact.ts:37-39`

All three are identical:

```ts
function generateId(): string {
  return crypto.randomBytes(16).toString("base64url").slice(0, NANOID_LENGTH);
}
```

**Fix**: Extract to a shared utility, e.g. `src/main/core/id.ts`:

```ts
export function generateId(): string {
  return crypto.randomBytes(16).toString("base64url").slice(0, NANOID_LENGTH);
}
```

Import from the single source in all three files.

---

## P2 — Code quality (nice to fix)

### 5. Single-message truncation in `trimSerializedMessages` lacks comment

**File**: `src/main/core/compact.ts:166`

```ts
kept[0] = segment.slice(segment.length - MANUAL_COMPACT_MAX_INPUT);
```

When a single message exceeds 100k chars, it keeps the **tail**. This matches the design intent ("trim oldest, keep most recent") but is non-obvious for a single message. A comment explaining the rationale would help future readers.

### 6. `COMPACT_SUMMARY_PROMPT` uses naive string replace

**File**: `src/main/core/compact.ts:248`

```ts
const prompt = COMPACT_SUMMARY_PROMPT.replace("{serialized_messages}", serializedMessages);
```

If `serializedMessages` contains the literal string `"{serialized_messages}"`, the replacement could produce unexpected output. Probability is near zero in practice, but a template function would be safer:

```ts
const prompt = `Summarize the following conversation, preserving:
...
<conversation>
${serializedMessages}
</conversation>`;
```

### 7. Compactions table lacks foreign key constraints

The `compactions` table has no `REFERENCES` on `session_id` or `boundary_message_id`. Deletion is handled manually in `deleteSession()` which is correct, but there's no DB-level guarantee against orphaned records.

Not urgent for V0 (SQLite foreign keys aren't even enabled — no `PRAGMA foreign_keys = ON`), but worth noting as tech debt.

### 8. `getToolDefinitions` defaults `includeLoadSkill` to `true`

**File**: `src/main/core/tool-dispatch.ts:79`

```ts
const includeLoadSkill = opts?.includeLoadSkill ?? true;
```

Currently harmless since orchestrator always passes it explicitly. But if any caller omits the option (e.g. in tests), `load_skill` will be included unexpectedly. Consider defaulting to `false` for safety, since the orchestrator always passes `true` when it wants it.

---

## P3 — Minor (optional)

### 9. `tools` bridge type missing from `global.d.ts`

**File**: `src/renderer/global.d.ts`

`ScorelBridge` type doesn't include the `tools` namespace (`approve`/`deny`), but `preload/index.ts` exposes it. Not introduced by M4, but discovered during review.

### 10. Test coverage gaps vs design doc

The design doc specified these test files, which are not present:

- `tests/unit/boundary-resume.test.ts` — merged into `compact.test.ts` (only 1 case)
- `tests/integration/compact-flow.test.ts` — not created
- `tests/integration/skill-flow.test.ts` — not created

Missing test scenarios:

| Scenario | Status |
|----------|--------|
| micro_compact with 10+ turns (verify first 7 replaced) | Missing — current test uses 5 turns, only 1 replaced |
| Compact failure (LLM returns empty / throws) at orchestrator level | Missing — only `compact.ts` unit test covers empty check |
| Multiple sequential compacts on same session | Missing |
| `load_skill` with unknown name at orchestrator level | Missing |
| FTS search still finds pre-compact messages | Missing |

---

## Summary

| Priority | Count | Action |
|----------|-------|--------|
| P0 (Bug) | 1 | Must fix — `applyBoundaryResume` seq-as-index |
| P1 (Design) | 3 | Should fix — stale tool description, double write, duplicate `generateId` |
| P2 (Quality) | 4 | Nice to fix — comment, template, FK, default value |
| P3 (Minor) | 2 | Optional — type declaration, test coverage |
