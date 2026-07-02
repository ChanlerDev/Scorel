# S0116: Background Bash System Reminders

## Goal

When a background Bash task finishes after the model has stopped waiting for it, deliver the final Bash result back into the session context through the existing `system_reminder` harness path.

This closes the gap left by S0115: the model should not have to poll every background command manually, and completed output should not be duplicated if it was already injected into context.

## Scope

- Add a daemon-owned completion hook for background Bash tasks created by the normal `Bash` tool.
- On background completion, append a hidden `harness_item` with:
  - `kind: "runtime_notice"`;
  - `origin: "system"`;
  - `data.type: "background_bash_completed"`;
  - `data.task_id`, `data.pid`, and `data.cwd`;
  - content containing the same final Bash result projection produced by the existing Bash result path.
- If the runtime is still executing, rely on the existing `refreshContext()` path so the reminder is injected into the current model loop.
- If the runtime is idle when completion is observed, enqueue a system-initiated chat turn rooted at the reminder event.
- Mark the task as delivered once the harness item is appended.
- A later `Bash({ task_id })` returns a compact advisory instead of the full result while the structured reminder is still visible in the current `buildContext()` projection.
- If compaction or context control removes that structured reminder from the current projection, `Bash({ task_id })` may return the final Bash result again.

## Not In Scope

- Generic task/sub-agent framework.
- GUI badge, terminal panel, or notification UI.
- Remote task persistence across daemon restarts.
- Replacing S0115 `Bash({ task_id })` polling.
- New protocol event type. The existing `harness_item` and `system_reminder` path is the product contract.

## Product Semantics

Background Bash has two delivery modes:

1. Explicit pull: the model calls `Bash({ task_id })` and receives the final normal Bash result.
2. Automatic delivery: the daemon observes completion and injects the same final Bash result through a hidden runtime notice.

Only one model-visible full result should be used by default. Once automatic delivery succeeds and remains visible, polling by `task_id` should acknowledge that the result was already injected instead of repeating it.

The visibility check is structural, not text-based. A compact summary that happens to mention the task id does not count as the delivered reminder. This keeps compaction behavior sane: if the actual structured reminder is gone, the raw result can be read again.

## Acceptance Criteria

- `createCodingTools()` accepts background Bash delivery hooks without depending on daemon internals.
- A background Bash task calls the completion hook only after it has first returned `status: "running"` to the model.
- A task actively being waited by `Bash({ task_id })` returns through the tool result path and does not auto-deliver at the same time.
- Delivered tasks return a compact advisory from `Bash({ task_id })` while their structured reminder remains visible.
- Delivered tasks return the normal Bash result again when the structured reminder is no longer visible.
- `createRealRuntime()` forwards the daemon hook into coding tools.
- CLI daemon, embedded CLI chat/run, and GUI local host runtime factories preserve the hook.
- The daemon appends a hidden `runtime_notice` harness item on completion.
- If the runtime is idle, the daemon starts a system-initiated continuation turn rooted at that reminder.

## Test Requirements

- Core tool tests:
  - delivered tasks return an advisory while the reminder is visible;
  - delivered tasks return the real result again after the reminder is no longer visible.
- Daemon embedded test:
  - a completion hook appends a `runtime_notice` harness item;
  - an idle runtime receives a follow-on provider turn containing the `system_reminder`;
  - `isDeliveryVisible()` returns true while the structured reminder remains in `buildContext()`.
- Full validation:
  - `pnpm --filter @scorel/core test -- src/tools/coding-tools.test.ts --runInBand`
  - `pnpm --filter @scorel/daemon test -- src/embedded/embedded.test.ts --runInBand`
  - `pnpm typecheck && pnpm test`

## Impacted Files

- `packages/core/src/tools/coding-tools.ts`
- `packages/core/src/tools/coding-tools.test.ts`
- `packages/daemon/src/index.ts`
- `packages/daemon/src/embedded/embedded.test.ts`
- `apps/cli/src/index.ts`
- `apps/cli/src/daemon-cli.ts`
- `apps/gui/src/main/local-host.ts`
- `docs/ROADMAP.md`

## Risks And Boundaries

- Completion can race with a model loop finishing. The implementation only starts a new system turn when the runtime is idle at delivery time; otherwise it relies on the current loop's context refresh.
- Background Bash state is still in the runtime-owned tool registry. Runtime replacement can reset that in-memory task state, matching the S0115 boundary.
- Bash output can contain secrets. S0116 reuses the existing Bash result projection and artifact path instead of inventing a second rendering path.
