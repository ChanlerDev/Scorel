# S0109: Scorel Run Headless Task Runner

## Goal

Add a non-interactive `scorel run` command for one-shot agent tasks, matching the headless shape of tools such as `claude -p` and `codex exec`.

The command must run through Scorel's existing embedded Host, daemon/client, runtime, tool, project registry, and JSONL session path. It must be usable by external harnesses such as Harbor / Terminal-Bench without entering the interactive `scorel chat` REPL.

## Scope

- Add `scorel run [prompt]`.
- Add prompt input forms:
  - positional prompt
  - `--prompt <text>`
  - `--prompt-file <path>`
  - `--stdin`
- Add execution options:
  - `--cwd <dir>`
  - `--state-dir <dir>`
  - `--sessions-dir <dir>`
  - `--session <id>`
  - `--timeout-ms <ms>`
  - `--output-format text|json|stream-json|none`
  - `--summary <path>`
  - `--report-dir <path>` (added by S0110 for benchmark-friendly reporting artifacts)
  - `--quiet`
  - `--model <role-or-id>`
  - `--reasoning-effort <minimal|low|medium|high|xhigh>`
  - `--provider <name>`
  - `--api <openai-completions|openai-responses|google-generative-ai|anthropic-messages>` / `--protocol <...>`
  - `--base-url <url>` / `--baseurl <url>`
  - `--api-key <key>` / `--apikey <key>`
- Reuse the same product path as `scorel chat`: embedded `ScorelHost`, `DaemonClient`, project registration, real runtime, and append-only session JSONL.
- Return only after the submitted user turn finishes, errors, or times out.
- Write an optional summary JSON containing status, session id, project id, cwd, state/sessions paths, session JSONL path, elapsed time, output format, error details, and the full Scorel events observed by the headless client during the run.

## Product Boundary

This spec targets the minimum complete command contract needed for Terminal-Bench / Harbor installed-agent integration. The command must be stable enough for an external harness to:

1. provide one task instruction;
2. run Scorel in a specific task workspace;
3. isolate state and session artifacts per trial;
4. pin provider protocol, base URL, API key, and model from the harness;
5. wait for one agent turn to finish or time out;
6. read deterministic summary/session artifacts without parsing human-oriented stdout.

This is intentionally narrower than the full non-interactive command surface exposed by mature coding agents such as Claude Code `-p` or Codex `exec`.

Current required parity:

- one-shot prompt execution;
- workspace selection;
- model/provider selection;
- output format selection;
- timeout;
- stable exit codes;
- session artifact persistence;
- machine-readable summary file.

Known gaps versus Claude Code / Codex that are not required for this first Terminal-Bench integration:

- explicit permission modes and tool allow/deny lists;
- sandbox / approval policy flags;
- system prompt and append-system-prompt overrides;
- structured input protocol beyond plain prompt/stdin;
- budget and cost limits;
- MCP config injection;
- debug file / verbose diagnostic switches;
- partial-message streaming controls;
- tool-set selection;
- no-persistence mode;
- full resume/continue UX beyond explicit `--session` load-or-create behavior.

These gaps should be prioritized from real Terminal-Bench failure evidence, not copied wholesale from other CLIs.

## Command Contract

Examples:

```bash
scorel run "Fix the failing test and run the relevant verification command."
scorel run --prompt "Summarize this project" --output-format json
scorel run --prompt-file /tmp/instruction.txt --cwd /workspace --state-dir /tmp/scorel-state --summary /logs/agent/scorel-summary.json --output-format none
scorel run --prompt-file /tmp/instruction.txt --api openai-completions --base-url https://api.example.test/v1 --api-key "$API_KEY" --model gpt-5.4-mini
cat instruction.txt | scorel run --stdin --output-format stream-json
```

Prompt precedence is strict:

1. positional prompt
2. `--prompt`
3. `--prompt-file`
4. `--stdin`

Exactly one prompt source is allowed.

Exit codes:

- `0`: run completed.
- `1`: runtime / provider / agent error.
- `2`: command usage or configuration error.
- `124`: timeout.

Output formats:

- `text`: stream assistant text deltas and tool summaries, like a compact non-interactive `scorel chat`.
- `json`: print one final JSON object.
- `stream-json`: print newline-delimited JSON events for live deltas and final status.
- `none`: print no stdout except unexpected lower-level output; intended for benchmark harnesses that use files and container state.

## Not In Scope

- Harbor agent adapter.
- Terminal-Bench dataset or leaderboard submission.
- ATIF trajectory export.
- Background Bash / long-running command lifecycle.
- Permission sandbox policy.
- Resuming previous headless runs beyond explicit `--session` load-or-create behavior.
- Replacing `scorel chat`.

## Acceptance Criteria

- `scorel run --prompt ...` creates or resumes a session and submits exactly one user message.
- `scorel run --base-url ... --api-key ... --api ... --model ...` uses a run-local provider config without writing Scorel config files.
- The command exits after `DaemonClient.sendMessage()` resolves, unless the completed turn produced a runtime/provider error event or an assistant message with `stopReason: "error"`, in which case it returns exit code `1`.
- `--cwd` controls the registered project workdir and runtime tool cwd.
- `--state-dir` isolates project registry and Scorel home.
- `--sessions-dir` controls where `{sessionId}.jsonl` is written.
- `--summary` writes deterministic JSON on success, runtime error, and timeout, including the full event list captured by the headless client.
- `--output-format none` produces no normal stdout on success.
- `--output-format json` produces parseable final JSON.
- `--output-format stream-json` emits parseable JSONL progress/final events.
- Timeout returns exit code `124` and best-effort cancels the active session.
- Usage errors return exit code `2` and print a concise error.

## Testing

- Extend `apps/cli/src/index.test.ts`.
- Add focused tests for:
  - prompt via `--prompt`.
  - prompt file.
  - stdin prompt.
  - output format `none`.
  - output format `json`.
  - summary file content and session JSONL path.
  - prompt source conflict.
  - timeout exit code and summary.

Run:

```bash
pnpm --filter @scorel/app-cli test -- index
pnpm --filter @scorel/app-cli typecheck
```

Before completion, run the repository check:

```bash
pnpm typecheck && pnpm test
```

## Affected Paths

- `apps/cli/src/index.ts`
- `apps/cli/src/index.test.ts`
- `docs/ROADMAP.md`
- `docs/spec/ship/S0109-scorel-run-headless-task-runner.md`

## Risks

- Treating `scorel run` as a wrapper around REPL stdin would make completion unreliable. It must call the daemon/client request path directly.
- Parsing stdout in external harnesses would be fragile. Summary JSON and session JSONL are the durable artifacts.
- `--state-dir` and `--sessions-dir` must remain explicit to support one-task-per-container benchmark isolation.
