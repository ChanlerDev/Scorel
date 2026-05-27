# S0011: Coding Agent Alpha Smoke

## Goal

Validate M2 as a complete Coding Agent Alpha rather than a collection of isolated tools.

This is M2.4. It proves `scorel chat` can complete a small coding task in a real temporary repository using search, read, edit/write, bash verification, Todo progress, session persistence, and resume.

## Deliverable

- End-to-end fake-provider coding smoke test.
- Temporary repository fixture with source files and a test command.
- Scripted task that requires `Glob` or `Grep`, `Read`, `Edit` or `Write`, `Bash`, and `Todo`.
- Assertions for CLI-visible tool output and Todo status changes.
- Assertions that tool calls, tool results, and Todo state persist to JSONL.
- Resume assertion that the latest context includes prior tool results and Todo state.

## Scenario

The smoke should use a small real workspace, for example:

1. User asks Scorel to fix a failing function.
2. Model creates a Todo list.
3. Model uses `Grep` or `Glob` to find the target file.
4. Model uses `Read` to inspect the file.
5. Model uses `Edit` or `Write` to change it.
6. Model uses `Bash` to run the relevant test.
7. Model marks Todo items complete.
8. CLI output shows tool calls, command result, and Todo transitions.
9. Session JSONL can be loaded again and used for resume.

## Scope

- Use fake provider / scripted tool calls for deterministic CI.
- Verify the full daemon/client/CLI path.
- Keep the fixture small and fast.
- Treat this spec as M2 completion proof.

## Not In Scope

- Real provider smoke as a CI requirement.
- Broad benchmark suite.
- Permission approval, sandbox, checkpoint, remote daemon, MCP, GUI.
- Complex multi-file refactors.

## Acceptance Criteria

- The end-to-end smoke fails before the integrated M2 path is complete.
- The smoke passes after S0008, S0009, and S0010 are implemented.
- CLI output includes visible Todo transitions and tool progress/result output.
- JSONL contains the expected user message, assistant/tool events, and Todo state changes.
- Resume loads enough context for the model to continue from the completed task.
- `pnpm typecheck && pnpm test` passes.

## Verification

- `pnpm --filter @scorel/app-cli test -- coding-agent-alpha`
- `pnpm --filter @scorel/core test -- tools`
- `pnpm --filter @scorel/daemon test`
- `pnpm --filter @scorel/client test`
- `pnpm typecheck && pnpm test`

## Affected Paths

- `apps/cli/`
- `apps/cli/src/index.test.ts`
- `packages/core/src/tools/`
- `packages/core/src/runtime/`
- `packages/daemon/`
- `packages/client/`
- `packages/protocol/src/`

## Risks

- A smoke that only checks isolated tool calls will not prove product value. It must go through CLI-visible daemon/client flow.
- A real-provider-only smoke would be flaky and hard to reproduce. Keep CI fake-provider based.
- If resume is skipped, Scorel loses its product distinction from a disposable coding chat.
