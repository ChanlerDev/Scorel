# S0120: Subagent Task Tools

## Goal

Give the coding agent a first-class subagent model that matches the existing Bash async pattern: run a nested agent with isolated context, wait synchronously for a while, then continue in the background with a stable `task_id`, and poll status/results by id.

## Scope

- Add model-facing tools:
  - `Task` — start a subagent or poll/wait an existing one by `task_id`;
  - `TaskStop` — stop a running subagent by `task_id`.
- `Task` parameters:
  - `prompt: string` — the only user message the subagent receives (fresh isolated context);
  - `description: string` — short 3–8 word label for UI/diagnostics;
  - `wait_time?: number` — seconds to wait before returning `status: "running"` (default **120**, shared with Bash; `0` backgrounds immediately);
  - `task_id?: string` — poll/wait on an existing subagent (same `wait_time` semantics);
  - `role?: "primary" | "standard" | "auxiliary"` — model role selection from the available-model pool (default `"standard"`).
- Sync completion within `wait_time` returns **only** the last assistant message text content (never the child transcript / tool trace).
- Background completion returns a compact running payload with `task_id` and `child_session_id`.
- Polling `Task({ task_id })` waits up to `wait_time` and returns the same last-assistant-only result when complete.
- After automatic reminder delivery remains visible, polling returns a compact advisory instead of duplicating the final result.
- Do **not** expose a model-facing full-transcript reader that re-injects isolated child context into the parent.
- Per-session directory layout:
  - `{sessionsDir}/{sessionId}/events.jsonl` — append-only event log (rebuildable session)
  - `{sessionsDir}/{sessionId}/session.log` — diagnostics
  - `{sessionsDir}/{sessionId}/summary.json` — derived observation cache
  - `{sessionsDir}/{sessionId}/tool-results/{6-char-hex}.txt` — oversized trimmed tool payloads
  - `{sessionsDir}/{parentSessionId}/sub-agents/{childSessionId}/...` (same session layout)
- Child session header meta records:
  - `kind: "subagent"`;
  - `parentSessionId`;
  - `taskId`;
  - `description`.
- Subagent sessions must not appear in normal `list_sessions` product listings.
- Nested depth is 1 for v1: child runtimes do not receive `Task` / `TaskStop` / `ReadThread`.
- Reuse the background-Bash delivery pattern for idle completion:
  - append a hidden `harness_item` `runtime_notice` with `data.type: "subagent_completed"`;
  - if the parent runtime is idle, start a system-reminder continuation turn.
- Active subagent work counts toward host active-work / detach lifetime.
- Host shutdown cancels running subagents and terminates nested background tool work (no orphan processes).

## Not In Scope

- Custom agent definition files (Claude/Codex-style agent markdown/TOML libraries).
- Nested subagents deeper than depth 1.
- GUI badge / subagent thread switcher UI.
- Cross-daemon remote persistence of in-memory task handles after Host restart.
- Parallel tool-call scheduling changes outside subagent tools themselves.
- Worktree isolation or permission sandbox changes.
- Replacing background Bash.

## Product Semantics

A subagent is a nested Scorel runtime + JSONL session owned by the parent session:

1. Parent calls `Task({ prompt, description })`.
2. Host creates a child session under `{parentSessionId}/sub-agents/{childSessionId}/`.
3. Child runtime starts with a single user message (`prompt`), parent project workspace, coding tools (without nested Task tools), and the selected role model.
4. Parent tool call waits up to `wait_time` (default 120s, shared with Bash).
5. If the child finishes in time, parent receives only the last assistant text content.
6. If not, parent receives `task_id` and can continue other work, poll/wait with `Task({ task_id, wait_time })`, or stop with `TaskStop`.

Result projection rules:

- Completed result = last non-empty assistant text content only.
- Child event log stays on disk under the child session directory for Host diagnostics; it is not returned into parent model context by default.

## Acceptance Criteria

- `Task` and `TaskStop` are registered on normal chat runtimes (no model-facing transcript dump tool).
- Synchronous `Task` returns only the child last assistant message content.
- Long `Task` returns `status: "running"` with `task_id` and `child_session_id` after `wait_time`.
- `Task({ task_id })` waits with the same `wait_time` contract and returns the final last-assistant result.
- Default `wait_time` is 120 seconds and is shared with Bash.
- `TaskStop({ task_id })` cancels a running child runtime.
- Sessions use `{sessionId}/events.jsonl` event logs; children live under `{parent}/sub-agents/{child}/`.
- Child sessions are excluded from `list_sessions`.
- Child runtimes do not expose nested Task tools.
- Completed background subagents deliver through `system_reminder` / harness notice when the parent is idle, matching S0116 style.
- Active subagent work keeps host active-work true.

## Test Requirements

- Core tool tests with a fake runner/registry:
  - sync completion returns last assistant only;
  - background + poll with wait_time;
  - stop;
  - delivered advisory;
  - no ReadThread / incremental tools.
- Session path helper tests for per-session + sub-agents directory layout.
- Daemon embedded tests:
  - child events.jsonl under parent/sub-agents;
  - child excluded from `list_sessions`;
  - sync Task end-to-end with fake provider;
  - nested tools absent on child runtime.
- Full validation:
  - `pnpm --filter @scorel/core test -- src/tools/subagent-tools.test.ts`
  - `pnpm --filter @scorel/daemon test -- src/embedded/embedded.test.ts`
  - `pnpm typecheck && pnpm test`

## Impacted Files

- `packages/core/src/tools/subagent-tools.ts` (new)
- `packages/core/src/tools/subagent-tools.test.ts` (new)
- `packages/core/src/tools/index.ts`
- `packages/core/src/session/index.ts`
- `packages/core/src/session/session.test.ts`
- `packages/protocol/src/events.ts`
- `packages/daemon/src/index.ts`
- `packages/daemon/src/projects/sessions.ts`
- `packages/daemon/src/embedded/embedded.test.ts`
- `docs/spec/tools.md`
- `docs/spec/runtime.md`
- `docs/ROADMAP.md`
- `docs/spec/ship/S0120-subagent-task-tools.md`

## Risks And Boundaries

- Subagents consume extra tokens and provider concurrency; default role is `standard`, not `primary`.
- Child sessions share the parent project workspace; concurrent writes can conflict. Prefer read-heavy or partitioned tasks in v1.
- In-memory task handles do not survive Host restart; child JSONL remains on disk for later manual inspection via path, but live `task_id` polling is process-local.
- Runtime recreation on the parent must keep the session-lane-owned subagent registry so background subagents survive model switches.
