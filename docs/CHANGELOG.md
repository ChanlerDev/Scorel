# Changelog

## Unreleased

## 0.0.12 - 2026-08-02

### Highlights

- Added a new 'max' reasoning effort option to the CLI and GUI, giving you finer control over model reasoning intensity.
- Introduced a public eval template for running Terminal-Bench benchmarks with your own provider, including a launcher script and privacy scrubber.

### Changes

- CLI and GUI now support the 'max' reasoning effort value, sent to the provider as `reasoning_effort: "max"`.
- Replaced the deprecated `@mariozechner/pi-ai` dependency with the maintained `@earendil-works/pi-ai` (from 0.73.1 to 0.83.0).
- Added a public eval directory with a template `.env.example`, a launcher script (`run_terminal_bench.sh`), and a job scrubber (`scrub_harbor_job.py`) to remove API keys and base URLs before optional Harbor uploads.
- The eval launcher defaults to Terminal-Bench 2.1, Daytona sandbox, 2 attempts, 3 concurrent trials, and 'max' reasoning, all configurable via the ignored `eval/.env` file.
- Documentation updated to describe the new eval workflow, including quick start steps, manual Harbor invocation, and privacy boundaries.

### Breaking Changes

- The pi-ai dependency package was renamed from `@mariozechner/pi-ai` to `@earendil-works/pi-ai`. External code directly importing from the old package must update its imports.

### Verification

- Provider unit tests assert that `xhigh` and `max` are sent as distinct `reasoning_effort` payload values.
- CLI integration tests verify that `--reasoning-effort max` is accepted, propagated into summaries, metadata, and trajectory output, and that invalid values are rejected with an updated error message.
- GUI composer test checks that the picker includes the new 'max' option.
- Harbor adapter and scrubber unit tests pass, including verification that scrubbing removes API key and base URL while preserving model identifiers.
- Package build scripts and GUI runtime bundle tests updated to reference the new pi-ai package and pass.
- The launch script validates required environment variables before running Harbor.

### Internal

- Upgraded pi-ai dependency to version 0.83.0, updating provider model resolution, streaming, and TypeBox usage.
- Updated documentation and test infrastructure to support the new eval workflow and dependency changes.

## 0.0.11 - 2026-08-02

### Highlights

- Added a first-class reasoning effort selector across CLI, GUI, session persistence, and evaluation reports.
- Background Bash tasks now automatically deliver their final results via system reminders, and idle sessions get a continuation turn to process the completion.
- Introduced async Bash sessions with background execution, polling, and stopping via task IDs.
- Added a visual context usage indicator in the GUI composer.

### Changes

- Added a `--reasoning-effort` flag to `scorel run` with values minimal|low|medium|high|xhigh.
- GUI composer now includes a Reasoning Effort dropdown, enabled only for reasoning-capable models.
- Persisted session headers and session events record the chosen reasoning effort; restored sessions recreate the runtime accordingly.
- Run summaries, scorel-metadata.json, and scorel-trajectory.json now include the requested reasoning effort.
- Added a public-safe Harbor installed-agent adapter that forwards reasoning_effort and records it in metadata.
- Background Bash tasks now automatically deliver results via system reminders when the model has moved on.
- Idle sessions automatically start a new chat turn when a background Bash task completes.
- When a background task result is delivered, polling with the same task_id returns a compact advisory instead of the full output.
- Added async Bash sessions: long-running commands can run in the background, return a task_id, and be polled or stopped.
- Added a visual context usage indicator in the GUI composer, showing a circular progress ring and tooltip.
- Context usage indicator now shows an 'unavailable' state when provider usage data is missing, instead of fabricated zero values.
- `pnpm gui` dev command now starts a development Host and launches the Electron GUI only after the Host is ready.
- Fixed daemon start to poll the state file for readiness and fully detach the background host process.

### Fixes

- Fixed the composer context indicator to correctly render an 'unavailable' state when provider usage data is unavailable, instead of showing misleading 0% usage and tooltip.
- Fixed daemon start to poll state file instead of reading stdout, and fully detach the background host process to avoid hanging pipes.

### Breaking Changes

- Bash tool no longer accepts timeout or maxOutputBytes arguments; existing calls using these will need to be updated.

### Verification

- CLI integration tests verify reasoning effort payload forwarding, session persistence, report fields, redaction, and invalid-effort usage error.
- Daemon tests verify persistence of reasoning effort, runtime rebuild on same-model effort change, and restore of persisted effort.
- GUI tests verify capability gating and model-selection normalization for reasoning effort.
- Harbor adapter tests verify allowed/invalid effort and runtime-only provider agent kwargs.
- Core unit tests verify that a delivered background Bash task returns an advisory while the reminder is visible and returns the real result again when the reminder is no longer visible.
- Daemon embedded test verifies that a completion hook appends a runtime_notice harness item and that an idle runtime receives a follow-on provider turn containing the system_reminder.
- New core tests cover synchronous Bash, long-running commands returning task_id, polling by task_id, stdin writing, BashStop, and artifact projection.
- Daemon test verifies that background tool work counts as active host work.
- Updated unit tests in composer and daemon CLI cover unavailable indicator and stdio detachment.
- Added dev-gui tests covering command planning, Host readiness gating, environment injection, failure cleanup, and daemon restoration.

### Internal

- Updated S0117 spec to describe honest 'unavailable' indicator for provider context usage, replacing previous note about fabricating zero values.
- Clarified in specs that GUI context usage indicator uses non-cached input plus output tokens, excluding cache tokens.
- Added specification details for future system-reminder delivery of async Bash task results.
- Updated S0115 spec to document read-only behavior of completed Bash tasks.
- Added dev-gui test script wired into `pnpm test`.

## 0.0.10 - 2026-06-28

### Highlights

- Daemon lifetime management: auto-started daemons now shut down when the last client disconnects
- New observability sync features for Langfuse and OpenTelemetry

### Changes

- `scorel up` and GUI auto-start use `--lifetime attached`, so the daemon shuts down when the last WebSocket client disconnects
- Manual `host serve` and `host start` default to `user_started`, daemon stays alive until explicit stop or process exit
- New `scorel observe sync --session <id> --target langfuse|otel` CLI command for manual observability export
- Added GUI Settings page for observability configuration
- Automatic post-turn sync to enabled targets when sync mode is 'auto'
- `host status` output now includes `lifetime=user_started` or `lifetime=attached`
- WebUI `/api/local-daemon` endpoint returns `launchIntent` field

### Fixes

- Config parser now ignores unknown keys/sections instead of throwing errors

### Breaking Changes

- `--idle-timeout-ms` flag removed; use `--lifetime attached` for similar behavior (shutdown on last client disconnect)

### Verification

- Updated unit tests for new `--lifetime` flag and attach behavior
- CLI tests for Langfuse sync payload generation, upload, credential loading
- CLI tests for OTel inspect and export with checkpoint
- Core tests for Langfuse trace mapping and OTel delta export
- Config tests for observability settings loading and unknown key handling
- Daemon tests for upserting settings and auto-sync behavior
- GUI test for observability settings rendering

### Internal

- Added specification S0113 for daemon attach lifetime (Planned)
- Added `[observability]` config sections: local, sync, langfuse, otel
- Sync state persisted under Scorel state directory
- IM extensions no longer prevent shutdown in `attached` mode

## 0.0.9 - 2026-06-26

### Highlights

- Run summary includes token usage, model info, cost estimates, and report files for benchmark compatibility.
- Provider errors (e.g., content_filter) now cause exit code 1 and include full event traces in summary.

### Changes

- `scorel run` now outputs usage (input/output/total tokens), model details, cost estimates, and paths to session JSONL, diagnostics, and artifacts via `--report-dir` flag.
- Session-level observation summaries (`<sessionId>.summary.json`) are maintained for consistent observability across CLI, GUI, and external harnesses.
- Summary JSON now includes a full `events` array of all Scorel events observed during the run.

### Fixes

- Headless runs with provider errors (e.g., content_filter cancellation) now exit with code 1 instead of 0, and include status 'error' and error message in the summary.

### Verification

- Integration and unit tests validate usage aggregation, known/unknown model cost, report file creation, API key redaction, provider error detection, and session summary creation/update.

### Internal

- Cost estimation uses a built-in price table from models.dev (snapshot models.dev-api-2026-06-27).
- Provider errors are preserved through pipeline: pi-ai provider, daemon, and CLI.

## 0.0.8 - 2026-06-26

### Highlights

- New `scorel run` command for headless, non-interactive task execution
- GUI now correctly loads memory status for the selected project on session preload
- Sessions can be attached even when provider credentials are missing

### Changes

- Added `scorel run` command with multiple prompt sources, execution options, provider overrides, and machine-readable summary output
- GUI now fetches and displays memory status for the selected project during app initialization
- Provider settings UI no longer autosaves on credential mode change, preventing incomplete data saves
- Daemon session loading no longer requires a runtime; sessions can be attached without provider API keys configured

### Fixes

- Fixed GUI not loading memory status for the selected project on session preload
- Fixed provider attach failure when provider config is incomplete (e.g., missing API key)

### Verification

- Tests cover `scorel run` prompt sources, output formats, summary, timeout exit code, and provider overrides
- Unit test confirms memory status is fetched for correct project on app mount
- Tests verify sessions can be loaded and messages sent even when provider credentials are missing

## 0.0.7 - 2026-06-24

### Highlights

- Introduce structured system_reminder content blocks across CLI, GUI, WebUI, and daemon, replacing ad-hoc XML strings.
- Bundle GUI runtime dependencies for self-contained execution.

### Changes

- System reminders now use structured `system_reminder` content blocks with origin, visibility, and scope, enabling consistent handling across all interfaces.
- GUI's CLI runtime is now bundled with all dependencies, eliminating the need for node_modules.

### Fixes

- Snip tool result no longer exposes internal span IDs or event counts to the model, keeping output concise.

### Breaking Changes

- Protocol version incremented from 4 to 5; session headers must now carry version 5.

### Verification

- All existing tests pass, with new tests covering system_reminder lowering, message-attached reminders, projector filtering, and bundled runtime integrity.

- Protocol version incremented to 5 with structured `system_reminder` content blocks.
- Snip tool results now return a concise model-visible confirmation while keeping internal span details out of provider context.

## 0.0.6 - 2026-06-23

### Highlights

- Packed GUI now bundles its own CLI runtime, enabling fully self-contained local Host startup without Node.js or global CLI.
- Agents can now use the `snip` tool to hide completed user turns from future context — reducing token waste and keeping conversations focused.

### Changes

- GUI now bundles its own CLI runtime for fully self-contained Host startup (no Node.js or global CLI required).
- Added `snip` tool that agents can call to mark a completed user turn as hidden from future LLM context.
- Protocol version incremented to 4 with new `context_control` event and `hide_user_turn` operation.
- UI (GUI and WebUI) now hides model-only text blocks (like `snip` reminders) from the visible transcript.
- Provider adapters now pass each tool's own parameter schema instead of hardcoding tool-specific parameters.

### Fixes

- Increased Host startup timeout from 10s to 30s to prevent timeouts in slower development environments.

### Breaking Changes

- Protocol version incremented from 3 to 4; requires protocol-version-aware clients.
- Packaged GUI no longer accepts `SCOREL_CLI_ENTRYPOINT` or `SCOREL_NODE_PATH` environment variables.

### Verification

- Unit and release tests verify bundled CLI usage in packaged GUI, snip tool end-to-end behavior, hidden spans in context builds, protocol version bump, and UI projector rendering.

### Internal

- Added planned spec S0107 for system reminder unification (documentation only).

## 0.0.5 - 2026-06-19

### Highlights

- New CLI commands `scorel version`, `scorel update`, and `scorel upgrade` for software lifecycle management.
- Oversized Bash tool output is now archived to session artifacts, returning compact head/tail projections to the model.
- GUI auto-update support with macOS DMG/ZIP packaging and incremental updates.

### Changes

- GUI and daemon now honor the selected chat model when sending messages.
- GUI settings are more resilient: ignore stale device responses, error boundaries on settings sections, and fixed state reset when switching devices.
- `scorel host serve` and `scorel host start` no longer idle-timeout by default; only convenience daemons (GUI auto-start, `scorel up`) enforce a 15-minute idle timeout.
- GUI auto-start uses an ephemeral port to avoid conflicts with user-started daemons.

### Fixes

- GUI provider model selection now persists correctly across profile refreshes and session creation.
- Daemon lifecycle hardened: foreground daemon stays alive until Ctrl+C/SIGTERM.

### Verification

- Unit tests for update helpers (semver comparison, npm check/install, auto-update gate).
- Unit tests for GUI main process (electron-updater import, manual update item, tray setup).
- Integration test for release asset collection and version lockstep.
- Tests for oversized Bash archive and projection logic.
- Tests for daemon idle timeout behavior.
- Tests for GUI settings resilience (stale data, error boundary, state reset).
- Tests for model selection fallback and normalization.

### Internal

- Update SHIP.md to clarify that small bug fixes may skip spec requirement; only changes affecting stable contracts or user-visible direction need a spec.
- Oversized Bash results are written to session-scoped artifacts, excluded from diagnostics and Relay.

- Add `scorel version`, `scorel update`, and `scorel upgrade`.
- Add hourly Host auto-update checks gated by active work state.
- Add GUI macOS release packaging and Electron updater metadata to the release path.
- Add GUI application menu and macOS status bar menu entries for manual update checks and common app actions.
- Document unsigned macOS GUI quarantine bypass command.

## 0.0.4 - 2026-06-14

### Highlights

- Config is now device-scoped only; project-level config is no longer read or written.
- GUI settings are device-scoped with relay device rename and project scope selector.
- Local daemon is a singleton background process with idle shutdown and shared state root.
- RTK token saving settings available in GUI for Bash execution.

### Changes

- GUI connection settings default to official Relay URL; editing requires explicit click.
- Pairing button label changed to 'Get Pair Code'.
- Paired Relay devices can be renamed locally; name persists across refresh.
- Provider delete button moved to a danger zone at bottom of settings panel.
- Token-saving statistics labels changed to Chinese (Bash 输出 Token / 已节省 Token).
- RTK token saving can be enabled/disabled in GUI settings, persisted in project config.
- Cumulative RTK savings stats are maintained across sessions and projects.
- RTK is detected from default shell; can be installed via Homebrew if missing.

### Fixes

- Glob results are now sorted by workspace-relative path for deterministic ordering across platforms.

### Breaking Changes

- Runtime no longer reads project `.scorel/config.toml`; existing project configs are ignored.
- GUI local projects and sessions are now stored under `~/.scorel/` instead of `~/.scorel/gui/`; old state is not migrated automatically.

### Verification

- Core config tests prove project config is ignored and device config is used.
- Daemon embedded tests prove settings writes with projectId write device config only.
- GUI rendering tests confirm device-scoped selector, provider delete placement, and Chinese token labels.
- New local-host test verifies device config writes to ~/.scorel/config.toml.
- E2E CDP script validates shared state paths and daemon lifecycle.
- Unit tests cover RTK detection, Bash execution with RTK, and runtime stats recording.

### Internal

- `scorel host start` launches a singleton background daemon; `scorel host serve` gains `--idle-timeout-ms` flag.
- `scorel up` ensures daemon is running but no longer owns its lifecycle.
- GUI attaches to singleton daemon instead of running embedded Host.
- gui-store.json lives at `~/.scorel/gui-store.json`.

- Add `scorel host start` for background singleton Host startup; `scorel up` now leaves the singleton Host running when WebUI exits.
- GUI local Host state now uses the shared `~/.scorel` root for Projects and Sessions, with `gui-store.json` stored at `~/.scorel/gui-store.json`.
- GUI starts and attaches to the singleton local daemon instead of starting a second local Host writer.
- Local daemon now idle-shuts down when there are no clients, no active work, and no active IM extensions; active IM keeps it alive until explicit stop.
- GUI connection settings now default to the official Relay, hide Relay URL editing behind an edit action, show `Get Pair Code`, support paired-device rename/details, and use a device-scoped settings selector.
- GUI Provider settings now place `删除提供商` in the Provider configuration block, token-saving stats use clear Chinese labels, and Relay device rows expose expand/edit affordances.
- Config loading now uses the device config only; Project `.scorel/config.toml` is no longer a runtime or Settings config source.

## 0.0.3 - 2026-06-12

### Highlights

- QQ Bot and WeChat inbound support: receive and route messages via official WebSocket or HTTP callback
- GUI now auto-refreshes session lists when IM sessions are created in the background
- Streaming thinking delta events in GUI for real-time thought display
- Memory status display and reliability improvements (dream trigger, duplicate detection)

### Changes

- GUI automatically refreshes session lists when IM sessions are created in the background
- Implement IM inbound runtime for QQ and WeChat (WebSocket gateway, HTTP callback server)
- Compact IM settings layout with collapsible rows for Telegram, QQ, and WeChat
- SendChannelMessage now supports optional attachments (image/file) with metadata
- Human-cadence guidance injected into IM replies (acknowledgement, progress updates)
- Add built-in QQ Bot and WeChat IM extension support (sending and receiving)
- Add thinking_delta event for streaming real-time thought content in GUI
- Add memory status query and GUI display for memory status
- Improve daily append quality with validation for low-signal summaries and duplicate detection
- Persist memory dream state (dirty/running/scheduled/failure) with restart recovery
- Refine GUI visual style: Codex-inspired polish for sidebar, empty workspace, composer, code blocks, and tool execution traces
- Add 'delete provider' button in GUI Settings with full deletion chain
- Fix IME composition handling in composer (Enter does not submit during IME input)
- Fix Shiki code block theme from dark to light to match GUI surface

### Fixes

- GUI provider deletion now removes provider, models, and dependent role assignments
- Dark code block theme fixed to light mode for better readability in dark GUI
- IME composition handling in composer fixed (Enter does not submit during IME input)

### Breaking Changes

- QQ and WeChat config keys changed: old `tokenEnv`, `token`, `webhookKeyEnv`, etc. are no longer supported; users must re-enter App ID/App Secret or Webhook URL.

### Verification

- Unit and integration tests for QQ gateway identify/heartbeat/dispatch/stop
- Unit and integration tests for WeChat callback verification and text message routing
- Tests for session change notification and renderer refresh behavior
- Tests for attachment validation and human-cadence guidance in channel harness
- Tests for QQ/WeChat adapter normalization and secret redaction
- Tests for streaming thinking deltas and final message reconciliation
- Tests for low-signal daily summary rejection and duplicate entry skipping
- Tests for memory dream state persistence and status retrieval
- GUI tests for IM settings layout, provider deletion, code block theme, and memory status display

### Internal

- Update README to clarify IM behavior details for QQ Bot and WeChat integrations
- Add planned spec S0089 for memory reliability and dream trigger improvements

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
