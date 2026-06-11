# Changelog

## Unreleased

## 0.0.2 - 2026-06-11

### Highlights

- Auto context compaction and session memory maintenance now keep sessions within model context limits.
- New GUI Electron shell with embedded local Host enables project management and chat locally.
- GUI now supports Relay device pairing, remote directory browsing, and explicit remote project selection.
- Streaming cursor, RAF-based event batching, and seven specialized tool blocks deliver a smoother, more informative chat experience.
- AI-powered release notes generation with DeepSeek now runs by default during releases.

### Changes

- Added auto context compaction and session memory maintenance (configurable threshold and async per-session memory files).
- Added built-in Telegram IM extension with long polling, Bot API integration, and GUI settings.
- Added extension manifest and IM channel runtime (loopback extension validates end-to-end flow).
- Added AppendDaily tool for agent-owned journal entries with delayed idle dream consolidation (configurable dreamIdleMinutes).
- Implemented automatic memory system with context injection, daily notes, dream consolidation, and GUI settings.
- Introduced provider-model profile contract: multi-layered config with primary/standard/auxiliary roles, GUI model picker, and auxiliary session title generation.
- GUI now has a three-pane layout (project list, session list, chat workspace) with local project registration.
- GUI settings now include Session Memory toggle and Auto Compact threshold selector.
- GUI sidebar uses macOS vibrancy glass effect, project picker anchored to trigger, and removed unimplemented placeholders.
- Redesigned settings page with macOS-style navigation sidebar, cards, toggles, selects, and link controls.
- Add streaming cursor, RAF-based event batching, and seven specialized tool blocks (Read, Glob, Grep, Edit, Write, Bash, TodoWrite) with unified diff viewer.
- Release workflow now creates GitHub Release and uploads npm tarball as asset (--no-github-release flag to skip).
- AI release notes generation runs by default during release (DeepSeek V4 Flash, fallback to minimal changelog with --no-generate-notes).
- Simplified GUI Provider and Model settings to user-facing fields with auto-save, model test button, and model config modal.
- Release workflow now removes generated diffs (e.g. dist, source maps) from AI changelog context.

### Fixes

- Install ripgrep in release action to fix Glob/Grep tests before publish.
- AI changelog collection now skips generated diffs before reading patches.
- Move session title generation to post-user-message hook and fix GUI dark code theme (now uses github-dark-default).
- Improve GUI sidebar layout with title truncation, resizing, and collapse/expand controls.

### Breaking Changes

- Old single [model] config section is replaced; existing .scorel/config.toml files with [model] must be migrated to new provider-model profile structure.
- Old [model] and [models.*] configurations are no longer compatible and will produce schema errors.

### Verification

- Core session tests verify compact parsing and barrier context behavior.
- Config tests validate new schema, reject legacy sections, preserve direct API keys on merge, and redact secrets.
- Daemon tests prove auto compact appends compact event and session memory maintained asynchronously.
- GUI rendering tests confirm new settings controls, sidebar behavior, and tool block rendering.
- Integration tests cover loopback IM extension, Relay device pairing, and remote project management.
- Release workflow tests cover AI note generation, GitHub Release creation, and asset upload.
- Full pnpm typecheck && pnpm test passes across all packages.

### Internal

- Add specification for GUI visual fidelity and settings macOS shell (S0071).
- The commit only adds documentation files; no code changes are included.
- Specify GUI streaming UX and specialized tool blocks (S0070 spec and roadmap update).
- Add spec for GUI Codex App UI refactor (S0069) and roadmap entry.
- Define GUI product boundary and Milestone 9 roadmap with SHIP specs.

- **release**: Generate changelog notes by default from commit summaries using DeepSeek V4 Flash, with a local preview command and an explicit `--no-generate-notes` escape hatch.
- **release**: Make AI changelog collection skip generated diffs before reading patches, preventing release Actions from failing on bundled `dist` or source-map changes.
- **release**: Install `ripgrep` in the manual release Action so the repo-level Glob/Grep tests run in CI before publishing.

## 0.0.1 - 2026-06-06

- **release**: Add public `scorel` package build, npm pack smoke, local release command, and manual GitHub Actions release workflow.
- **docs**: Split M1 CLI Alpha into executable ship specs.
- **docs**: Move numbered S specs under `docs/spec/ship`.
- **docs**: Align spec boundaries with the daemon/core/client package split.
- **docs**: Define AI delivery protocol and versioning policy.
- **docs**: Keep roadmap milestone-level and defer future S specs until implementation.
