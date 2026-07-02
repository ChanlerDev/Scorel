# S0115: Async Bash Sessions

## Goal

Let Bash commands continue in the background without blocking the model loop, while preserving the existing Bash result and artifact contract.

Long commands should not require a fake timeout. `wait_time` controls how long the current tool call waits before returning control to the model. It does not define the command lifetime.

## Scope

- Extend `Bash` with:
  - `wait_time?: number` in seconds, default 60;
  - `task_id?: string` for an existing background Bash task;
  - `command?: string`, used to start a new process when `task_id` is absent, and used as exact stdin bytes when `task_id` is present.
- If a new Bash command finishes within `wait_time`, return the existing Bash tool result.
- If it is still running after `wait_time`, return a compact running result with:
  - `status: "running"`;
  - `task_id`;
  - `pid`;
  - `cwd`.
- Calling `Bash` with `task_id` and no `command` waits for output/final completion.
- Calling `Bash` with `task_id` and `command` writes that exact string to stdin, then waits for output/final completion.
- Completed Bash tasks are read-only. Calling `Bash` with a completed `task_id` and no `command` can return the final Bash result again; calling it with `command` must fail instead of writing to a closed process.
- Add `BashStop({ task_id })` to stop a background Bash task. The implementation owns process-group cleanup; models should not kill PIDs directly.
- Preserve the existing Bash final result shape and S0104 artifact behavior. Async completion must call the same `bashResult()` path as synchronous completion.
- Keep background Bash tasks visible to runtime active-work detection so attach-owned daemon shutdown does not treat a running background command as idle.
- Do not expose a command lifetime timeout in the model-facing Bash schema.

## Not In Scope

- Generic task abstraction for sub-agents or monitors.
- `spawn_agent` / Claude-style sub-agent task tool.
- GUI badge or terminal multiplexer UI.
- Remote artifact download.
- Automatic system-initiated chat turns after a background command completes.
- Rewriting existing session JSONL files.

## Product Semantics

`wait_time` is a wait window, not a kill timer. A compile that runs for 15 minutes should keep running until it exits or the model/user calls `BashStop`.

`pid` is returned as diagnostic evidence only. The stable control handle is `task_id`; direct PID killing is unsafe because PIDs can be reused and one PID may not cover the process group.

The single `command` field keeps the model contract simple:

- `Bash({ command })` starts a new Bash task.
- `Bash({ task_id })` polls or waits for the task.
- `Bash({ task_id, command })` writes exact stdin bytes to that task.

## System Reminder Boundary

S0115 does not auto-start a new chat turn when a background task completes.

The existing reminder system can already project persisted harness items into model context on the next agent call. S0116 defines daemon-owned `background_bash_completed` runtime notices and whether session-idle completion should enqueue a system-initiated follow-up turn.

For S0115, completion is surfaced through explicit `Bash({ task_id })` calls and normal final Bash tool results.

When S0116 system-reminder delivery exists, it must mark the task result as delivered-to-context. After that point:

- `Bash({ task_id })` should return a compact advisory instead of the full final result, for example: `Task task_... has already been injected through a system reminder. Do not read it again unless the user explicitly asks for the raw result.`
- `Bash({ task_id, command })` must still reject because completed tasks are read-only.
- The raw final Bash result should remain available internally for diagnostics/artifacts, but the model-facing default should avoid duplicating context that was already injected.

This keeps the two delivery paths from double-counting the same output in model context: explicit polling returns the Bash result; reminder delivery returns the Bash result once through the reminder and future polling only acknowledges that delivery.

## Acceptance Criteria

- `Bash` exposes `wait_time` and `task_id` in its schema and description.
- `Bash` no longer exposes `timeout` or `maxOutputBytes` as model-facing parameters.
- A command still running after `wait_time` returns a compact running result with `task_id` and `pid`.
- `Bash({ task_id })` returns the final normal Bash result when the background command completes.
- `Bash({ task_id, command })` writes exact stdin bytes and can return the final normal Bash result.
- `Bash({ task_id, command })` rejects completed tasks; completed tasks remain readable by `task_id`.
- `BashStop({ task_id })` stops a running background Bash task.
- Oversized final output still uses S0104 artifact projection through the shared Bash result path.
- Runtime active-work detection returns true while a background Bash task is running.

## Test Requirements

- Core tool tests:
  - synchronous Bash still returns normal Bash result;
  - long Bash returns `task_id` after `wait_time`;
  - polling by `task_id` returns final Bash result;
  - writing stdin through `Bash({ task_id, command })` works;
  - completed tasks can be read again but reject additional stdin writes;
  - `BashStop` stops a running task;
  - artifact projection still works for oversized final output.
- Runtime/daemon tests:
  - active work remains true while a background Bash task is running.
- Full validation:
  - `pnpm --filter @scorel/core test -- src/tools/coding-tools.test.ts`
  - `pnpm typecheck && pnpm test`

## Impacted Files

- `packages/core/src/tools/coding-tools.ts`
- `packages/core/src/tools/coding-tools.test.ts`
- `packages/core/src/tools/index.ts`
- `packages/core/src/runtime/index.ts`
- `packages/daemon/src/index.ts`
- `docs/ROADMAP.md`

## Risks And Boundaries

- Background processes can outlive the immediate model turn. They must remain attached to a `task_id` and be stoppable through `BashStop`.
- Returning PIDs is useful for diagnosis but must not become the primary control contract.
- Background stdout/stderr can contain secrets. Final output continues to use the existing Bash result/artifact projection rules.
- Runtime replacement for model switching can reset per-runtime tool state. A future generic task registry may move this state to the session lane if background tasks need to survive runtime recreation.
