# S0089: Memory Reliability And Dream Trigger

## Goal

Make Scorel memory actually useful in normal GUI/agent use by tightening the `AppendDaily -> idle dream -> memory injection` loop.

The business value is continuity. If users finish meaningful work and later return to the project, Scorel should remember durable progress, decisions, and follow-ups without relying on fragile manual reminders.

## Context

S0081/S0082 established the memory architecture:

- daily evidence is written through the agent-owned `AppendDaily` tool;
- successful append marks the project dirty;
- daemon schedules dreaming after project idle time;
- memory content re-enters future turns through the hidden memory harness.

In practice this is not reliable enough yet:

- `AppendDaily` depends too much on the model remembering a prompt instruction near the end of work;
- daily entries can be low quality when the model records vague summaries instead of durable evidence;
- dream triggering is hard to observe and easy to miss;
- idle-only scheduling means memory may not update before the app/host exits;
- GUI has no clear signal that daily/dream/memory actually happened.

## Scope

### AppendDaily Quality

- Make the tool contract harder to ignore in completed meaningful turns.
- Improve the journal schema/prompt so entries prefer concrete completed work, decisions, evidence paths, and follow-ups over generic summaries.
- Add validation or lightweight scoring for empty, duplicate, or low-signal entries.
- Keep `AppendDaily` project-scoped and append-only.

### Dream Trigger Reliability

- Audit the current daemon dirty-project and idle-timer path.
- Ensure a successful `AppendDaily` reliably schedules a dream attempt.
- Add a recovery path for pending daily evidence when the process restarts before idle dream fires.
- Consider a manual or debug trigger if it materially improves verification and support.

### Observability

- Expose enough local state to answer:
  - when was the last daily append;
  - whether the project is dirty;
  - whether dream is scheduled/running/failed;
  - when project memory was last updated.
- Surface this in GUI Settings or a compact project memory status area.
- Keep failures non-blocking for chat turns, but visible enough to debug.

### Injection Verification

- Verify that updated project memory is actually injected into subsequent model context.
- Add tests or a local verification path proving `AppendDaily` evidence can become project memory and then influence a later turn.

## Not In Scope

- Full activity recorder.
- Vector search or semantic memory.
- Topic memory file fan-out.
- Root/global memory promotion beyond the existing guarded behavior.
- Replacing the memory harness with provider system prompt content.

## Acceptance Criteria

- Meaningful completed work has a reliable path to daily evidence without depending only on user reminders.
- Successful `AppendDaily` schedules or queues dream work even across host restarts.
- Dream status is inspectable from local state and surfaced in GUI.
- Low-quality or duplicate daily entries are reduced by contract, validation, or tests.
- A verified path proves daily evidence can update project memory and be injected into a later turn.
- Existing memory settings remain backward compatible.

## Testing Requirements

- Core tests for `AppendDaily` schema/quality validation.
- Daemon tests for dirty-project scheduling, idle dream, restart recovery, and failure visibility.
- GUI tests for memory status rendering if a GUI surface is added.
- Integration-style test or scripted verification for `AppendDaily -> dream -> memory injection`.
- Full `pnpm typecheck && pnpm test`.

## Status

Planned.
