# S0009: Code Discovery Tools

## Goal

Expose structured code discovery tools through the existing runtime, daemon, client, and CLI path: `Glob` and `Grep`.

This is M2.2. It keeps common code search out of ad hoc shell output so tool results are easier to display, persist, replay, and summarize.

## Deliverable

- Built-in `Glob` tool.
- Built-in `Grep` tool.
- Tool registration in the default `coding` preset.
- Tool registration in the `readonly` preset.
- Structured result shape for matched paths and content hits.
- CLI-visible search progress / result output that is compact and debuggable.

## Tool Semantics

### `Glob`

- Finds files by glob pattern under a cwd.
- Returns stable, normalized paths.
- Sorts results predictably.
- Enforces a maximum result count.
- Fails predictably for invalid patterns and inaccessible cwd.

### `Grep`

- Searches file contents using ripgrep-compatible semantics.
- Supports regex patterns.
- Supports glob/type filtering when practical.
- Supports output modes for matching files and matching lines.
- Enforces maximum result count and output size.
- Fails predictably for invalid regex, inaccessible cwd, and missing ripgrep.

## Scope

- Keep search tools in `@scorel/core`.
- Keep execution owned by runtime / daemon, not CLI.
- Persist tool calls and tool results in session JSONL.
- Keep errors as tool-result data visible to the model and user.

## Not In Scope

- Full file indexing.
- LSP symbol search.
- Web search.
- Directory listing as a standalone `LS` tool.
- MCP search tools.

## Acceptance Criteria

- `scorel chat` can use `Glob` and `Grep` through the daemon/client path.
- Fake-provider tests can trigger both tools without real API credentials.
- `Glob` returns stable path lists and respects result limits.
- `Grep` returns structured matches and respects result/output limits.
- Tool calls and results are persisted in JSONL and restored into context.
- CLI-facing code does not import session/runtime internals directly.

## Verification

- `pnpm --filter @scorel/core test -- tools`
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

- If `Grep` just wraps arbitrary shell text, search results will be hard to display and replay. Keep the output structured.
- If result limits are missing, a large repository can flood the session context.
- If Bash remains the preferred search route, the model will learn the wrong tool habit.
