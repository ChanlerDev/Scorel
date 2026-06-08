# S0070: GUI Streaming UX And Specialized Tool Blocks

## Goal

Light up real-time streaming UX in the GUI renderer (built on the IPC channels added in `S0069`) and replace the `DefaultJsonBlock` fallback for the seven first-class coding tools with specialized renderers. Validate the full GUI surface end to end against a real LLM provider on both local and Relay project paths.

This is the second half of the M9 Follow-up: GUI Codex App polish.

Reference screenshots from M9 Follow-up brief:

- image2 — populated session view: action chips (`已探索 3 个文件`, `Connect Chrome`, `已使用 浏览器`), assistant message no-bubble, user bubble right-aligned.

---

## Scope

### 1. Streaming projector wiring

`apps/gui/src/renderer/chatbox/projector.ts` already accepts the full `ScorelEvent` union from S0069. Activate handling for transient events:

- `turn_start` / `turn_end` — toggle per-turn `streaming` flag.
- `message_start` — initialize an in-flight assistant message in the current turn with empty text parts and `streaming: true`.
- `message_end` — flip `streaming: false`, attach `usage` / `stopReason`.
- `text_delta` — append delta to the in-flight message's first text part.
- `error` — surface as a per-turn error chip without ending the projector state.

Use `delta-batch.ts` (RAF batcher) to coalesce `text_delta` events to one React update per animation frame.

### 2. Streaming cursor

`apps/gui/src/renderer/chatbox/StreamingCursor.tsx`:

- inline-block span, 1ch × 1.1em, `--color-text-faint` background.
- CSS keyframe `scorel-caret-blink` 1s steps(2, end), defined in `styles.css`.
- Mounted as the last sibling inside the streaming assistant message (not inside the markdown subtree, so DOM updates don't disturb it).

### 3. Autoscroll region + jump-to-bottom

`apps/gui/src/renderer/chatbox/AutoscrollRegion.tsx`:

- IntersectionObserver on a 1px sentinel at the bottom of the transcript scroll container.
- "At bottom" sticky flag: while `true`, every transcript update scrolls the sentinel into view.
- Exit "at bottom" on user-initiated scroll-up (wheel, touchpad, keyboard PageUp).
- Re-enter "at bottom" only when sentinel reaches viewport.
- `JumpToBottom` floating button (28×28 circle, `--color-surface-raised`, `ChevronDown` icon) appears bottom-right when not at bottom; click resets sticky flag and scrolls.

Logic ported from `apps/webui/components/chatbox/autoscroll-region.tsx`; CSS migrated from Tailwind to `styles.css` classes.

### 4. Specialized tool blocks

Register specialized renderers via `registerToolBlock(name, Component)` in `apps/gui/src/renderer/chatbox/tool-blocks/registry.ts`:

#### 4.1 ReadBlock

For `Read`:

- Action chip header: `{ChipIcon} 已读取 {file}` (line range if provided).
- Collapsed by default.
- Expand reveals file path and read range; **does not** rerender file contents (transcript stays scannable).
- Error result swaps icon to `--color-status-err` and auto-expands.

#### 4.2 GlobGrepBlock

For `Glob` and `Grep` (single component, registered for both names):

- Action chip header: `已探索 N 个文件` (Glob) or `已搜索 "{pattern}"` (Grep).
- Expand: list of matched paths or grep hits with line numbers; truncated to 50, "show more" reveals all.

#### 4.3 EditWriteBlock

For `Edit` and `Write`:

- Action chip header: `{Pencil} 已编辑 {file}` or `{FilePlus} 已创建 {file}`, with `+N -M` change counters.
- Inline collapsible diff view: unified diff with red/green line backgrounds (background only, not full-line color floods). Diff parsed from `tool_call.args.old_string` / `new_string` (Edit) or `tool_call.args.content` (Write, treats prior empty as new file). No external diff library; a small in-renderer line-by-line LCS suffices for the visual.
- Errors expand by default.

#### 4.4 BashBlock

For `Bash`:

- Action chip header: `{Terminal} {command}` truncated to 80 chars.
- Body: `<pre>` with stdout/stderr; collapsible after 12 lines, "expand" reveals all.
- Exit code shown as `→ exit 0` (`--color-status-ok`) or `→ exit N` (`--color-status-err`).

#### 4.5 TodoWriteBlock

For `TodoWrite`:

- Header: `{ClipboardList} 任务列表 (n / total)`.
- Body: list of todos with status checkboxes:
  - `pending` → `Square` icon.
  - `in_progress` → `Loader` icon (animated spin via CSS).
  - `completed` → `CheckSquare` icon.
- Strikethrough completed items in `--color-text-muted`.

#### 4.6 Default fallback unchanged

Tools without a registered specialized block fall back to `DefaultJsonBlock` from S0069.

### 5. End-to-end verification

Add `apps/gui/scripts/verify-m9-gui-followup.mjs` (or extend existing `verify:m9-gui` if present). Steps:

1. Launch GUI build via Electron headless (or via the existing pnpm pipeline).
2. Local project path: register a temp git workspace, send a prompt that exercises Read, Edit, Bash, TodoWrite. Assert each tool renders its specialized block.
3. Relay project path: use the existing Relay verification harness (`pnpm verify:m9-gui` from S0068) to run the same prompt over Relay; assert the same tool blocks render.
4. Persistence smoke: after sending, kill renderer, relaunch, reopen session, confirm tool blocks rerender from JSONL persistence.

Save evidence to `docs/spec/ship/S0070-gui-e2e-verification.md` (screenshots optional but encouraged).

---

## Non-Goals

- No further sidebar / composer / settings restructuring beyond what S0069 shipped.
- No additional tool kinds beyond the seven listed (Read / Glob / Grep / Edit / Write / Bash / TodoWrite). Skill / Subagent / Web tools are deferred.
- No diff-viewer for non-Edit/Write tools.
- No Markdown table-of-contents, link previews, syntax-aware folding, or other prose UX.
- No dark-mode implementation.
- No reverse-reuse of the GUI components inside WebUI. (Future product direction.)
- No new IPC channels. All streaming flows through the channel set added in S0069.

---

## Acceptance Criteria

- Sending a prompt streams visible character-by-character text into the assistant turn, with a blinking cursor at the trailing edge.
- `text_delta` events do not cause one React re-render per delta; `delta-batch.ts` coalesces them.
- Scroll behavior: while scrolled to bottom, transcript follows new tokens. Scroll up — autoscroll pauses. Jump-to-bottom button appears; click returns to live tail.
- All seven coding tools render through their specialized blocks. `DefaultJsonBlock` is reserved for unknown tool names only.
- Errors in tool calls auto-expand the relevant block and surface `--color-status-err` accents.
- Edit / Write blocks render a visible unified diff with `+` / `-` line markers and per-line tinting.
- TodoWrite renders a checkbox list whose state updates live as new `tool_result` events arrive.
- Real provider e2e on local + Relay project paths passes; `pnpm verify:m9-gui` (or its successor command) reports green.

---

## Test Requirements

```bash
pnpm --filter @scorel/app-gui build
pnpm --filter @scorel/app-gui typecheck
pnpm --filter @scorel/app-gui test
pnpm typecheck
pnpm test
pnpm pack:smoke
pnpm verify:m9-gui
git diff --check
```

Manual e2e (real provider, both paths):

- Local project: clone or use an existing temp repo; ask the GUI to "list the README, then add a TODO row, then run echo hello". Confirm Read, TodoWrite, Bash blocks render correctly.
- Relay project: pair a Relay device, register a remote project, repeat the prompt. Confirm identical behavior over Relay.
- Streaming visual: send a long prompt that produces ≥ 1k tokens of text; confirm cursor blinks, autoscroll follows until user scrolls up, jump-to-bottom returns to live tail.
- Reload mid-stream: kill renderer during streaming; relaunch and reopen the session; confirm persisted events replay through the projector and tool blocks render the same way.

Record evidence in `docs/spec/ship/S0070-gui-e2e-verification.md`.

---

## Affected Paths

- `apps/gui/src/renderer/chatbox/projector.ts` — light up transient event handling.
- `apps/gui/src/renderer/chatbox/delta-batch.ts` — wired into Transcript.
- `apps/gui/src/renderer/chatbox/StreamingCursor.tsx` — new.
- `apps/gui/src/renderer/chatbox/AutoscrollRegion.tsx` — new.
- `apps/gui/src/renderer/chatbox/Transcript.tsx` — wrap children in `AutoscrollRegion`, mount `StreamingCursor` on the in-flight message.
- `apps/gui/src/renderer/chatbox/tool-blocks/ReadBlock.tsx`, `GlobGrepBlock.tsx`, `EditWriteBlock.tsx`, `BashBlock.tsx`, `TodoWriteBlock.tsx`, `diff/UnifiedDiff.tsx` — new.
- `apps/gui/src/renderer/chatbox/tool-blocks/registry.ts` — register the seven tool names.
- `apps/gui/src/renderer/styles.css` — keyframes for cursor + spin, jump-to-bottom button style.
- `apps/gui/scripts/verify-m9-gui-followup.mjs` (or extension of existing verify script).
- `docs/spec/ship/S0070-gui-streaming-and-tool-blocks.md` — this file.
- `docs/spec/ship/S0070-gui-e2e-verification.md` — verification artifact.
- `docs/ROADMAP.md` — flip M9 Follow-up status to Done after verification.

---

## Implementation Notes

- Adopt webui's `apps/webui/lib/events/delta-batch.ts` `RAFBatcher` shape verbatim. The batcher is already copied into the GUI source tree by S0069.
- Keep `StreamingCursor` and `AutoscrollRegion` framework-agnostic: no Tailwind classes, no Next assumptions; use plain class names defined in `styles.css`.
- Diff parsing in `EditWriteBlock`: a 60-line LCS over already-split lines is sufficient; this is visualization, not authoritative semantics. `Edit` already pre-supplies `old_string`/`new_string` so the line ranges are bounded.
- `TodoWriteBlock` reads the latest `tool_result.result` (a JSON array per `S0012`); render purely from that array. No separate state machine.
- Specialized blocks must remain robust against partial data (`tool_call` arrived but `tool_result` not yet, or `tool_result.isError = true` with malformed payload). Fall back to `DefaultJsonBlock` rendering for the unparsable case rather than crashing the transcript.

---

## Risks

- High-frequency `text_delta` over Relay can drop frames if RAF batcher cadence is misaligned with WebSocket pacing. Mitigation: batch by `requestAnimationFrame` and `flushSync` only on `message_end`.
- Diff renderer for Write of very large files could blow up Markdown render cost. Mitigation: cap diff body to first 200 changed lines, "show more" reveals all, plain `<pre>` rendering (not Markdown).
- Real-provider e2e flakiness: tool ordering depends on model behavior. Verification asserts the per-tool render path, not exact sequence.
- IPC `sessionEvent` push frequency under streaming may saturate Electron renderer. Mitigation: RAF batcher; rely on the same coalescing webui has shipped.

---

## Out Of Scope (Reaffirmed)

- No new product surface beyond M9 + M9 Follow-up.
- No webui changes.
- No SSH / HTTP API / Ecosystem work — those remain on the M10+ roadmap.
