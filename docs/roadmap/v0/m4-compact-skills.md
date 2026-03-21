# V0-M4: Compact & Skills

> Three-layer compact (micro + manual + boundary resume) + load_skill (two-layer injection)

## Goal

Enable long sessions via context management and on-demand skill loading.

## Scope

### Compact
- **micro_compact**: per-turn, automatic — replace old tool_result content with `"[Previous: used {tool_name}]"` (KEEP_RECENT=3 turns)
- **manual compact**: user-triggered — LLM summarizes conversation, creates compaction record with boundary
- **Compaction storage**: non-destructive — `compactions` table, `sessions.active_compact_id`, messages never deleted
- **Boundary resume**: after compact, active context = instruction layer + summary + post-boundary messages
- **Compact transcript**: optional JSONL snapshot saved to disk for recovery/export

### Skills
- **Two-layer injection**: Layer 1 (metadata in system prompt) + Layer 2 (full SKILL.md via `load_skill` tool_result)
- **Skill scanning**: scan skill directories at session start, parse YAML frontmatter
- **load_skill tool**: registered as 5th tool, `approval: "allow"`
- **Skill error handling**: unknown skill name → error tool_result; bad YAML → skip with warning log

## Key Implementation Notes

### micro_compact Algorithm

```
For each tool_result in messages:
  Calculate turn distance from current turn
  If turn distance > KEEP_RECENT (3):
    Replace content with "[Previous: used {tool_name}]"
    Set details to undefined (free memory)
  Original preserved in message_json (DB) and EventLog
```

Applied:
- Before each LLM request (in-memory only; DB not modified)
- During session resume (same logic)

### Manual Compact Flow

1. User triggers via UI button or command
2. Session enters `compacting` state
3. Serialize messages: role + content text, tool results truncated to 500 chars
4. Cap at 100,000 chars (trim oldest, keep most recent)
5. Send to LLM with summary prompt template
6. On success:
   a. Create `compaction` record (summary_text, boundary_message_id, provider_id, model_id)
   b. Update `sessions.active_compact_id`
   c. Optionally save transcript JSONL to disk
   d. Emit `compact.manual` event
7. On failure: emit `compact.failed` event, session returns to `idle`, UI shows error

### Compact Summary Prompt

```
Summarize the following conversation, preserving:
1. Key decisions and their rationale
2. Files that were created or modified (with paths)
3. Current task status and next steps
4. Any unresolved issues or errors

Be concise but complete. This summary will replace the conversation history.

<conversation>
{serialized_messages}
</conversation>
```

### Skill Loading

```
Session start:
  scan skills/ directory
  for each SKILL.md:
    parse YAML frontmatter (name, description, version)
    if parse fails: log warning, skip
    add to skill metadata list

System prompt includes:
  "Available skills:\n  - {name}: {description}\n  ..."

load_skill("name") → read full SKILL.md → return as tool_result content
```

## Acceptance Criteria

- [ ] **Case I**: Manual compact → new messages → resume → only post-boundary messages + summary in context
- [ ] micro_compact: after 10 tool rounds, old tool_results show placeholder in context
- [ ] Manual compact: summary generated, transcript saved, session continues cleanly
- [ ] Compact failure: session continues with uncompacted context, error shown
- [ ] load_skill: model can list available skills and load one on demand
- [ ] Unknown skill: error tool_result returned, model can handle gracefully
- [ ] Search still finds content from pre-compact messages (FTS entries preserved)

## Files to Create/Modify

| File | Action |
|------|--------|
| `src/main/core/compact.ts` | Create: micro_compact + manual compact logic |
| `src/main/storage/compactions.ts` | Create: compaction CRUD |
| `src/main/skills/skill-loader.ts` | Create: scan + parse + load |
| `src/main/core/orchestrator.ts` | Modify: integrate compact + skill tool |
| `skills/` | Create: example SKILL.md files |

## Definition of Done

Long sessions don't blow up context. Manual compact is recoverable (transcript preserved, messages not deleted). Skills load on demand.
