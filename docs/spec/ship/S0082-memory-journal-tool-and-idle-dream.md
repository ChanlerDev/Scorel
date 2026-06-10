# S0082: Memory Journal Tool And Idle Dream

## Goal

Refine S0081 memory so daily is owned by the agent main loop and dream is delayed until project idle time.

The business value is better memory quality: the agent records daily evidence while it still has full task context, and the auxiliary dreamer consolidates a continuous session/project slice instead of prematurely freezing every turn.

## Scope

### AppendDaily Tool

Add a built-in `AppendDaily` tool when memory and daily are enabled.

The tool is append-only and writes to:

```text
~/.scorel/memory/projects/<projectId>/daily/YYYY-MM-DD.md
```

The model passes structured journal data:

- `summary`
- `completed`
- `decisions`
- `followUps`
- `memoryCandidates`

The daemon/core owns the actual path, date, append format, and validation. The model does not edit daily files through generic file tools.

### Prompt Contract

The baseline prompt tells the agent to call `AppendDaily` once near the end of meaningful completed work when the tool is available.

This prompt is a tool-use contract. It must not carry root/project/daily memory content. Memory content continues to enter `messages[]` through the existing hidden memory harness.

### Idle Dream

Remove per-turn dream consolidation.

After `AppendDaily` succeeds, daemon marks the project dirty and schedules dream after `memory.dreamIdleMinutes`.

Rules:

- new daily append resets the timer;
- `dreamIdleMinutes = 0` means run as soon as the event loop is idle, mainly for tests/debugging;
- dream uses the auxiliary model;
- dream updates project `MEMORY.md`;
- dream may update root `MEMORY.md` only when `promoteRoot` is enabled;
- dream failure never fails the user turn.

### Settings

Extend memory settings with:

```toml
[memory]
dreamIdleMinutes = 60
```

GUI Settings must expose the idle delay.

## Not In Scope

- Full activity recorder.
- Topic memory files.
- Vector or semantic recall.
- Manual dream trigger.
- GUI memory file editor.
- Persistent cross-process dream scheduler after host process exit.

## Acceptance Criteria

- `AppendDaily` is available to the main chat runtime only when memory and daily are enabled.
- `AppendDaily` appends structured daily content to the fixed project daily path.
- Completed turns no longer write daily from daemon-side `userText + assistantText` fallback.
- Completed turns no longer run auxiliary dream immediately.
- Successful `AppendDaily` schedules idle dream according to `dreamIdleMinutes`.
- Idle dream reads current memory and recent daily evidence, then writes project/root memory from auxiliary model output.
- `dreamIdleMinutes` is parsed/rendered in config and exposed in GUI Settings.
- Memory content still enters the LLM through `messages[]` memory harness, not provider system prompt.

## Testing Requirements

- Core tests for `AppendDaily` formatting and append-only behavior.
- Provider/tool schema test coverage through existing tool conversion path.
- Daemon test proving daily is written by `AppendDaily`.
- Daemon test proving idle dream updates project/root memory.
- GUI test proving idle delay control renders.
- Full `pnpm typecheck && pnpm test`.

## Impacted Files

- `packages/core/src/memory/*`
- `packages/core/src/config/index.ts`
- `packages/core/src/provider/pi-ai.ts`
- `packages/core/src/instructions/index.ts`
- `packages/daemon/src/index.ts`
- `packages/protocol/src/events.ts`
- `apps/gui/src/renderer/settings/*`
- tests near the changed modules

## Risks And Boundaries

- The agent may forget to call `AppendDaily`. This is acceptable for V1; the tool contract and prompt make the desired behavior explicit without daemon fabricating journal content.
- The idle timer is in-process. If the host exits before the timer fires, daily evidence remains durable and can be consolidated by a future manual or scheduled dream feature.
- Root promotion remains high-risk and must stay constrained to stable cross-project preferences.
