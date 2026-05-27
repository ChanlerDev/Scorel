# S0010: Todo Tool And CLI

## Goal

Expose a normal Todo List tool and make Todo state changes visible in the CLI.

This is M2.3. It gives coding sessions a lightweight progress backbone without introducing plan mode, subagents, or workflow orchestration.

## Deliverable

- Built-in `Todo` tool.
- Todo item model with `id`, `content`, and `status`.
- Supported statuses: `pending`, `in_progress`, `completed`.
- Replace/update semantics for the current session's Todo list.
- Session persistence for Todo state changes.
- Daemon/client events for Todo changes.
- CLI rendering for the current Todo list and status transitions.

## Tool Semantics

### `Todo`

- Maintains a session-scoped Todo list.
- Creates, updates, reorders, and deletes Todo items.
- Allows at most one `in_progress` item at a time.
- Treats Todo changes as structured state, not free-form assistant text.
- Emits clear errors for invalid ids, invalid statuses, duplicate `in_progress` items, and malformed updates.

## CLI Semantics

- CLI displays Todo list changes when they happen.
- CLI shows status transitions clearly enough for the user to understand current progress.
- CLI output stays plain terminal text; no TUI is required.
- Resume should reconstruct the latest Todo state from session JSONL.

## Scope

- Keep Todo state session-scoped.
- Keep Todo owned by runtime / daemon, not CLI-local memory.
- Persist Todo changes in JSONL.
- Keep Todo visible to the user and available to the model as useful context.

## Not In Scope

- Plan mode.
- Dependencies between Todo items.
- Owners, teams, subagents, or delegation.
- Cross-session Todo storage.
- Calendar/reminder automation.

## Acceptance Criteria

- `scorel chat` can use `Todo` through the daemon/client path.
- Todo changes are persisted in JSONL and restored on resume.
- CLI visibly updates when Todo items are created, completed, deleted, or moved to `in_progress`.
- Invalid Todo updates return structured tool-result errors.
- A test verifies that two items cannot both be `in_progress`.
- CLI-facing code does not import session/runtime internals directly.

## Verification

- `pnpm --filter @scorel/core test -- todo`
- `pnpm --filter @scorel/daemon test`
- `pnpm --filter @scorel/client test`
- `pnpm --filter @scorel/app-cli test`
- `pnpm typecheck && pnpm test`

## Affected Paths

- `packages/core/src/tools/`
- `packages/core/src/runtime/`
- `packages/daemon/`
- `packages/client/`
- `apps/cli/`
- `packages/protocol/src/`

## Risks

- If Todo is only assistant text, resume and UI state become unreliable. Store it as structured session state.
- If Todo becomes a workflow engine, M2 will stall. Keep it to a plain list.
- If CLI hides Todo changes, the user loses trust in long-running coding tasks.
