# S0012: Coding Tools Maturity

## Goal

Mature the M2 coding tool surface by aligning the contracts with Claude Code / pi-coding-agent style behavior while keeping the current daemon/client/runtime path unchanged.

This is a tool-semantics hardening spec, not a checkpoint, sandbox, permission UI, LSP, subagent, or remote daemon spec.

## Deliverable

- Replace `Todo` with `TodoWrite`.
- Keep the user-visible tool set to `Read` / `Write` / `Edit` / `Bash` / `Glob` / `Grep` / `TodoWrite`.
- Harden `Read` state so writes require complete coverage of the current file version.
- Truncate long default `Read` results and report returned line count, total line count, truncation, and continuation offset.
- Harden `Write` as full-file create/update with pre-read coverage and stale checks for existing files.
- Harden `Edit` as exact single replacement with pre-read coverage and stale checks.
- Move `Glob` and `Grep` to ripgrep-backed implementations.
- Keep tool errors visible as tool results through the existing runtime/daemon/client path.
- Update pi-ai tool schemas and CLI smoke to use `TodoWrite`.

## Tool Semantics

### `Read`

- Arguments: `file_path`, `offset?`, `limit?`, `full?`.
- Reads one file from the local workspace.
- Supports `offset` and `limit`.
- Defaults to returning at most 2,000 complete lines.
- Also enforces a dynamic output budget of 1% of the current model context window by removing whole lines from the end of the result.
- `full: true` uses a larger 10% context-window budget.
- If no model context window is available, the fallback context window is 200,000 tokens.
- Token usage is estimated on the line-numbered tool result text, conservatively as roughly one token per three characters until a model tokenizer is available.
- Never truncates inside a line. If one line exceeds the output budgets, `Read` fails instead of returning a partial line.
- Returns `startLine`, `endLine`, `totalLines`, `truncated`, `nextOffset`, `canWrite`, `estimatedTokens`, and `tokenBudget`.
- Returns stable 1-based line numbers.
- Rejects binary files and document/media types that are not yet supported by a dedicated reader path.
- Read ranges are accumulated for the current file version.
- `canWrite` becomes true once the accumulated ranges cover the full current file.
- Truncated reads do not unlock `Write` / `Edit` until follow-up reads cover the remaining lines.
- `full: true` requests the full file and cannot be combined with `offset` or `limit`; it is still subject to the 10% dynamic token budget.
- Directories fail with a hint to use `Glob`.

### `Write`

- Arguments: `file_path`, `content`.
- Creates new files without a prior read.
- Updating existing files requires prior read coverage of the full current file.
- Updating existing files fails if the file changed since the read.
- Writes are full-file replacements.
- Successful writes update the read snapshot to the new full content.
- Model-facing result is lightweight: success text plus `type`, `filePath`, and `bytes`; full old/new contents are not returned.

### `Edit`

- Arguments: `file_path`, `old_string`, `new_string`, `replace_all?`.
- Requires prior read coverage of the full current file.
- Fails if the file changed since read.
- Fails if `old_string === new_string`.
- Fails if `old_string` is missing.
- Fails if `old_string` matches multiple times unless `replace_all` is true.
- Successful edits update the read snapshot to the new full content.
- Model-facing result is lightweight: success text plus file path and replacement counts; full diffs and file contents are reserved for UI/event metadata.

### `Bash`

- Arguments: `command`, `cwd?`, `timeout?`, `maxOutputBytes?`, `description?`.
- Runs in the workspace or a workspace subdirectory.
- Enforces timeout and output truncation.
- Non-zero exits return tool results, not runtime crashes.
- Timeout returns a tool error visible to the model.

### `Glob`

- Arguments: `pattern`, `path?`, `head_limit?`, `offset?`.
- Uses ripgrep file discovery (`rg --files`) plus `--glob` filters.
- Defaults to current workspace when `path` is omitted.
- Returns relative file paths.
- Applies pagination and truncation metadata.

### `Grep`

- Arguments: `pattern`, `path?`, `glob?`, `output_mode?`, `-B?`, `-A?`, `-C?`, `context?`, `-n?`, `-i?`, `type?`, `head_limit?`, `offset?`, `multiline?`.
- Uses ripgrep for content search.
- Default `output_mode` is `files`.
- Supports `content`, `files`, and `count`.
- Adds result limits by default.
- Uses ripgrep `--max-columns 500` to avoid noisy minified/base64 lines.
- Returns relative paths and pagination metadata.

### `TodoWrite`

- Arguments: complete `todos` array.
- Each todo has `content`, `status`, and optional `activeForm`.
- Status is `pending`, `in_progress`, or `completed`.
- Allows at most one `in_progress`.
- Replaces the session todo list as a whole.
- If all provided todos are `completed`, the stored current list becomes empty.
- Result includes only `oldTodos` and `currentTodos`; a text reminder may explain automatic clearing.

## Not In Scope

- `MultiEdit`.
- Permission approval UI.
- Sandbox execution.
- Checkpoint / rollback.
- LSP.
- Background Bash / monitor.
- Web tools.
- MCP tool loading.

## Acceptance Criteria

- `TodoWrite` is registered and exposed to pi-ai instead of `Todo`.
- `TodoWrite` returns old/current todo lists and clears stored current todos when all requested todos are completed.
- Default `Read` truncates long files by complete lines and returns the current line range and total line count.
- `Read` enforces line and dynamic estimated-token budgets without returning partial lines.
- `Read` rejects binary/document/media files until dedicated readers are implemented.
- Partial reads can unlock `Write` or `Edit` only after their accumulated ranges cover the full current file.
- Any covered read unlocks `Write` and `Edit` only while the file is unchanged.
- `Write` creates new files without pre-read and updates existing files only after complete read coverage.
- `Edit` rejects missing, ambiguous, unchanged, stale, and incomplete-coverage edits.
- `Write` and `Edit` do not return full file contents in model-facing tool results.
- `Glob` returns ripgrep-backed file results with pagination metadata.
- `Grep` returns ripgrep-backed search results for `files`, `content`, and `count`.
- CLI smoke uses `TodoWrite` and still verifies search, read, edit, bash, persistence, and resume.
- `pnpm --filter @scorel/core test -- tools`
- `pnpm --filter @scorel/app-cli test -- coding-agent-alpha`
- `pnpm typecheck && pnpm test` or equivalent per-package commands pass.

## Affected Paths

- `packages/core/src/tools/coding-tools.ts`
- `packages/core/src/tools/coding-tools.test.ts`
- `packages/core/src/provider/pi-ai.ts`
- `apps/cli/src/index.test.ts`
- `docs/spec/tools.md`
- `docs/ROADMAP.md`

## Risks

- Ripgrep availability can fail outside developer machines. Return a clear tool error instead of falling back to slow ad hoc scanning.
- Renaming `Todo` to `TodoWrite` changes model-facing tool calls and tests; keep this as S0012 rather than mixing with unrelated features.
- Coverage-based write unlocks is more complex than Claude Code's partial-view rejection; keep tests focused on stale detection and full-file coverage so long-file pagination does not become unsafe.
