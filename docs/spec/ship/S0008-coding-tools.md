# S0008: File And Shell Coding Tools

## Goal

Expose the first coding-agent tool surface through the existing runtime, daemon, client, and CLI path: `Read`, `Write`, `Edit`, and `Bash`.

This is M2.1. It makes `scorel chat` capable of reading files, editing files, writing files, and running verification commands in a real workspace. Search tools and Todo are intentionally separate follow-up specs.

## Deliverable

- Built-in `Read` tool.
- Built-in `Write` tool.
- Built-in `Edit` tool.
- Built-in `Bash` tool.
- Tool registration path for the default `coding` preset.
- Runtime loop support for emitting tool call and tool result messages through daemon/client events.
- Session persistence for tool calls and tool results.
- CLI-visible tool progress / result output that is plain and debuggable.

## Tool Semantics

### `Read`

- Reads a file from the local filesystem.
- Accepts an absolute or cwd-relative file path; paths resolve under the CLI working directory unless absolute.
- Does not read directories.
- Supports `offset` and `limit` by line.
- Returns content with stable 1-based line numbers.
- Fails predictably for missing files, directories, unreadable files, and oversized reads that require `offset` / `limit`.
- Records enough read state for `Write` / `Edit` stale checks.

### `Write`

- Creates a new file or fully rewrites a file.
- Existing files must be read first in the current session before `Write`.
- If the file changes after the recorded read, `Write` must fail instead of overwriting.
- Prefer `Edit` for normal modifications to existing files.
- Creates parent directories only when explicitly requested by args or implementation contract; do not silently create broad directory trees.

### `Edit`

- Performs exact string replacement.
- Existing files must be read first in the current session before `Edit`.
- If the file changes after the recorded read, `Edit` must fail instead of applying stale changes.
- `old_string` must match exactly once unless `replace_all` is true.
- `old_string === new_string`, missing matches, and ambiguous matches must fail with clear tool-result errors.
- Creating new files through `Edit` is not required for M2; use `Write`.

### `Bash`

- Executes a command in a specified cwd.
- Has a default timeout and a hard maximum timeout.
- Truncates large stdout/stderr while preserving exit code and enough diagnostic tail.
- Returns non-zero exits as tool results, not thrown runtime failures.
- Is for commands, tests, builds, git status, and project scripts.
- Must not be encouraged as the primary path for reading or editing files; use `Read`, `Write`, and `Edit`.

## Scope

- Keep tools in `@scorel/core`.
- Keep execution owned by runtime / daemon, not CLI.
- Keep CLI as an entrypoint that displays events.
- Keep tool errors as data visible to the model and user.

## Not In Scope

- Snapshot-based recovery.
- Permission approval UI or policy.
- Sandbox execution.
- `Grep`, `Glob`, `Todo`, `LS`, notebook editing, image/PDF reading.
- MCP tool loading.
- Remote daemon or reconnect semantics beyond existing M1 path.
- Rewind / compact / cancel / steer / followUp UX.

## Acceptance Criteria

- `scorel chat` can use the built-in tools through the daemon/client path.
- A fake-provider test can trigger `Read`, `Write`, `Edit`, and `Bash` without real API credentials.
- Tool call and tool result events are persisted in JSONL and restored into context.
- `Write` and `Edit` reject existing-file changes when the file was not read first.
- `Write` and `Edit` reject stale writes after external file modification.
- `Edit` rejects missing and ambiguous `old_string` matches.
- `Bash` enforces timeout and output truncation.
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

- Overbuilding Bash permissions will stall M2. Use minimal local execution constraints first: cwd, timeout, truncation, and structured errors.
- Letting Bash replace file tools will make edits harder to inspect and test. Tool descriptions must strongly prefer `Read` / `Write` / `Edit` for file operations.
- Skipping stale checks on `Write` / `Edit` can overwrite user edits. Pre-read state is mandatory for existing-file writes.
