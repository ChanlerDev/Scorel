# S0097: RTK Token Saving Settings

## Goal

Add an opt-in GUI setting that enables RTK-backed token saving for Scorel Bash tool execution without changing session replay, model prompts, or existing tool input contracts.

RTK here means Rust Token Killer: a CLI command rewriter/filter that compresses shell command output before it reaches the LLM context.

## Scope

- Add project-scoped `[runtime] tokenSavingRtk = boolean` config.
- Add GUI Settings page `Token 节省` with an RTK enable toggle and status.
- When the user enables the setting, Host ensures the `rtk` binary is available:
  - first detect `rtk` on PATH;
  - if missing on macOS/Linux with Homebrew available, attempt `brew install rtk`;
  - if install fails, keep the setting but report RTK as unavailable.
- Bash tool execution and RTK discovery use the user's default shell path (`options.defaultShell` where provided, then `SHELL`, then OS user shell, then `/bin/sh` fallback), not a hard-coded `/bin/bash`.
- Shell invocation preserves the command string and uses shell-compatible command flags (`-lc` for sh/bash/zsh-like shells, `-c` for csh/tcsh/fish-like shells).
- When enabled and available, the Bash tool asks RTK to rewrite the original command and executes the rewritten command, while preserving the original tool input contract and cwd semantics.
- Bash tool result details expose RTK application state plus estimated output/saved tokens for Scorel-owned UI/diagnostics.
- Runtime Settings summarizes RTK token savings from a maintained Scorel runtime stats file across projects on the current host.
- Chat transcript rendering continues to display the original Bash tool-call command, not the RTK rewritten execution command.
- Session JSONL and persistent events keep the same tool result shape; no prompt or input assembly contract changes.

## Not In Scope

- Changing model message assembly.
- Compressing Read / Grep / Glob built-in tool results.
- Provider-specific token accounting.
- A per-session savings breakdown view.
- Global shell hook installation through `rtk init`.
- Silent install at app startup.

## Acceptance Criteria

- `tokenSavingRtk = false` keeps Bash behavior equivalent to the current path.
- `tokenSavingRtk = true` uses RTK rewrite for Bash command execution when RTK is available, without changing the tool-call input command string.
- Tool results sent back into model context include only the user-visible content, not RTK execution metadata or rewritten command details.
- GUI Bash tool blocks display the original tool-call command even when RTK rewrites the command at execution time.
- RTK detection and first-enable install checks run in the same default shell environment as command execution, so zsh-configured PATH entries are visible.
- Runtime creation resolves the RTK executable whenever `tokenSavingRtk` is enabled, so saved settings affect actual Bash tool execution, not only the Settings UI.
- Runtime Settings token totals come from Scorel-maintained RTK stats updated when Scorel persists tool results, so other agents' RTK usage in the same project is not counted.
- GUI Settings can enable/disable RTK token saving and shows available/unavailable status.
- Config parsing rejects unknown `[runtime]` keys.
- RTK install is only attempted after the user enables the setting.
- Existing tests, typecheck, and full test suite pass.

## Test Requirements

```bash
pnpm --filter @scorel/core test -- src/config/config.test.ts src/tools/coding-tools.test.ts
pnpm --filter @scorel/daemon test -- src/embedded/embedded.test.ts
pnpm --filter @scorel/app-gui test -- src/renderer/gui-shell.test.tsx
pnpm verify:m9-gui # service-level local/relay plus Electron CDP settings + prompt smoke
pnpm typecheck
pnpm test
```

## Status

Done.
