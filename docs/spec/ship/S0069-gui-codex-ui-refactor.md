# S0069: GUI Codex App UI Refactor (Skeleton + Markdown + Tool Block Registry)

## Goal

Rebuild the M9 GUI renderer to match Codex App reference screenshots (image2-6): three-segment sidebar with project-inline sessions, pill composer, project picker pill with overlay, Add Remote Project modal, dedicated Settings view. Establish the foundation for Markdown rendering and an event-driven tool-block component registry. Add a streaming IPC channel so future streaming UX (S0070) does not require another IPC reshape.

This spec replaces the single-file `apps/gui/src/renderer.tsx` (559 lines, character-icon, two-list sidebar, embedded settings popover) with a modular renderer tree under `apps/gui/src/renderer/`.

Source of truth for product model is M9 (`S0064`–`S0068`); this spec is M9 follow-up polish, not a product re-scoping.

Reference screenshots:

- image2 — populated session view with topbar title, action chips, review banner.
- image3 — empty state with large H1, pill composer, project picker mini pill below.
- image4 — project picker overlay: search, list, "add local / add remote / no project".
- image5 — Add Remote Project modal: host dropdown, path input + reset, directory list, cancel / add.
- image6 — sidebar with each project inline-expanding its own sessions.

User-explicit deletions from the Codex reference (do **not** ship):

- empty-state "connect messaging / email / files" plugin recommendation cards.
- bottom-of-sidebar global "对话" history group.
- in-composer review banner (`2 个文件已更改 +95 -1` / `审查`).
- "不使用项目" (null project / workspace mode) — GUI is Project-first per `S0064`.
- real model-picker / mic / "完全访问" toggling — all stay disabled placeholders (Codex semantic).

---

## Scope

### 1. Renderer tree

Replace `apps/gui/src/renderer.tsx` and the inline `<style>` block in `apps/gui/src/index.html` with:

```
apps/gui/src/renderer/
├── main.tsx                 # ReactDOM root
├── App.tsx                  # view-mode router (workspace | settings)
├── styles.css               # tokens + base + layout, replaces 553-line inline style
├── tokens.ts                # token names exported for component literals
├── shell/
│   ├── Sidebar.tsx
│   ├── ProjectTree.tsx      # one project row + inline session list + collapse
│   ├── SidebarActionRow.tsx # `+ 新对话` / 搜索 / 插件 / 自动化
│   └── use-collapsed.ts     # localStorage["scorel.gui.collapsed"]: { [key]: boolean }
├── workspace/
│   ├── Workspace.tsx        # empty | session
│   ├── EmptyState.tsx       # H1 + composer + project picker pill
│   ├── SessionView.tsx      # transcript + composer
│   └── Topbar.tsx           # right-only stack icon (no title bar)
├── composer/
│   ├── Composer.tsx
│   ├── ProjectPickerPill.tsx
│   ├── ProjectPickerMenu.tsx     # overlay: search + list + add local / add remote
│   └── AddRemoteProjectDialog.tsx # image5 modal
├── chatbox/
│   ├── Transcript.tsx
│   ├── projector.ts              # copy of apps/webui/lib/events/projector.ts (independent)
│   ├── delta-batch.ts            # copy (S0070 will activate)
│   ├── TurnUser.tsx
│   ├── TurnAssistant.tsx
│   ├── TurnHarness.tsx
│   ├── Markdown.tsx              # react-markdown + remark-gfm + rehype-sanitize
│   ├── ShikiCodeBlock.tsx        # lazy shiki, github-light-default
│   └── tool-blocks/
│       ├── registry.ts
│       ├── ToolBlock.tsx          # routes (call, result?) → registry hit or DefaultJsonBlock
│       └── DefaultJsonBlock.tsx
├── settings/
│   ├── SettingsPage.tsx
│   └── RelayDevicesPanel.tsx
└── icons/
    └── index.ts                  # lucide-react re-exports (Plus, Search, Puzzle, Clock,
                                  #   Settings, Folder, ChevronRight, ChevronDown, X, Mic,
                                  #   ArrowUp, Square, Globe, RotateCcw, Check)
```

Renderer entry moves to `apps/gui/src/renderer/main.tsx`. Old `apps/gui/src/renderer.tsx` deleted.

### 2. Design tokens

Token values copied verbatim from `docs/design.md` §2 (locked palette, sans-only fonts, five-step type ladder, spacing, radii, shadow disabled). Tokens defined in `:root` of `styles.css`. Dark-mode placeholder via `@media (prefers-color-scheme: dark)` block kept commented out.

### 3. Sidebar — three-segment, project inline sessions

```
┌─ 280px Sidebar (--color-surface) ──────────┐
│  + 新对话              [active route /]    │
│  🔍 搜索                [disabled]          │
│  🧩 插件                [disabled]          │
│  🤖 自动化              [disabled]          │
│                                            │
│  PROJECTS                       (12px caps) │
│                                            │
│  ▾ workspace                                │
│      梳理对比分析框架        ⌘1            │
│  ▸ warp                                     │
│  ▸ Scorel                                   │
│  ▸ Scorel  Chanler...   ●online             │
│  ▸ Tickel                                   │
│  ▸ docx-pure                                │
│  ...                                        │
│                                            │
│  ⚙ 设置                       (mobile icon) │
└────────────────────────────────────────────┘
```

- Project row click = toggle collapse, **not** navigate. Active project derives from active session route only.
- Session row click = open session in workspace.
- Collapse persists to `localStorage["scorel.gui.collapsed"]`.
- `+ 新对话` row routes to workspace empty state with current project preselected.
- No `+` button next to "PROJECTS" header in this segment — add-project entrypoint is also exposed as a row at the bottom of the project picker overlay (sidebar `+` is dual-entry per user decision: keep one `+` button at the projects header for sidebar discoverability).
- No "对话" global history group. No theme toggle row.

### 4. Composer

Pill, 24px radius, 1px `--color-border`, no shadow.

```
┌──────────────────────────────────────────────────┐
│  随心输入                                        │
│                                                  │
│  ⊕  ⚠ 完全访问 ▾                5.5 超高 ▾  🎤  ●│
└──────────────────────────────────────────────────┘
       ▱ workspace ▾                ← project picker pill, BELOW composer
```

- `⚠ 完全访问 ▾` rendered with `--color-status-warn`. Disabled placeholder.
- `5.5 超高 ▾` rendered as plain pill. Disabled placeholder.
- `⊕` and `🎤` disabled placeholders.
- Send button: 32×32 circle, `--color-accent` background, `↑` glyph. While `inFlight`, swaps to red square (`--color-status-err`) acting as cancel.
- `meta-row` removed from composer shell. Project picker pill is a sibling component below composer.

### 5. Project picker pill + overlay

Pill: `▱ {project.displayName} ▾` rendered below composer. Click opens an overlay positioned beneath the pill (image4):

- Top: search input `🔍 搜索项目` (filters list).
- Middle: project list, each row `▱ name`, current selection trailing `✓`.
- Divider.
- `▱+ 添加本地项目 ›` → triggers `window.scorel.addLocalProject()` (existing IPC).
- `🌐 添加远程项目` → opens `AddRemoteProjectDialog`.
- "不使用项目" row **omitted** (user decision: GUI is Project-first).

### 6. Add Remote Project modal

`AddRemoteProjectDialog.tsx` reproduces image5:

- Title `添加远程项目` + close (×).
- Subtitle `选择已连接的远程主机,并输入此项目的文件夹。`
- `远程主机` dropdown sourced from `state.relayDevices`.
- `文件夹路径` input + reset (`RotateCcw`) button.
- Directory listing (entries from `window.scorel.listRemoteDirectories(deviceId, path)`), click = navigate into.
- Footer hint `此远程文件夹将作为单独项目显示在侧边栏中。`
- `取消` / `添加项目` buttons. `添加项目` calls `window.scorel.addRemoteProject(deviceId, workDir)`.

### 7. Settings independent view

In-renderer view-mode switch via `useState<"workspace" | "settings">("workspace")`. Sidebar `⚙ 设置` row sets mode to `"settings"`. Settings header has a back button (`ChevronLeft` + `返回`) restoring `"workspace"`. **No `react-router`**.

`SettingsPage.tsx` sections (S0069 ships only Relay Devices; future settings sections are future specs):

- Relay Devices: relay URL input, `Pair` button, `Refresh` button, displayed pair code on success, device list with online/offline pills. Functionality 1:1 from current `SettingsPopover` in `apps/gui/src/renderer.tsx:476-555`.

The Relay popover at the sidebar bottom is removed.

### 8. Markdown pipeline

`Markdown.tsx`:

- `react-markdown` 10.x with `remark-gfm` 4.x and `rehype-sanitize` 6.x.
- Sanitize schema duplicates the allowlist in `apps/webui/components/chatbox/markdown-view.tsx` (allow `className` attribute, allow code-block class for highlighter).
- Code blocks dispatch to `ShikiCodeBlock.tsx`. Shiki 4.x lazy `createHighlighterCore` shared across renders, language loaded on demand, theme `github-light-default`. Fallback to plain `<pre><code>` while loading.

GUI-only adjustments vs webui copy: drop Tailwind class names; use plain CSS class names defined in `styles.css`.

### 9. Tool-block registry (event-driven, generic)

`tool-blocks/registry.ts`:

```ts
import type {
  ToolCallContentBlock,
  ToolResultContentBlock,
} from "@scorel/protocol";

export type ToolBlockProps = {
  call: ToolCallContentBlock;       // packages/protocol/src/messages.ts:13
  result?: ToolResultContentBlock;  // packages/protocol/src/messages.ts:21
  pending: boolean;                 // result not yet arrived
};

export type ToolBlockComponent = React.ComponentType<ToolBlockProps>;

const registry = new Map<string, ToolBlockComponent>();
export function registerToolBlock(toolName: string, component: ToolBlockComponent): void;
export function lookupToolBlock(toolName: string): ToolBlockComponent;
```

`ToolBlock.tsx` looks up by `call.toolName`; falls back to `DefaultJsonBlock` (renders `tool_call.args` and `tool_result.result` as JSON fences via `Markdown.tsx`).

`Transcript.tsx` projects `PersistentEvent[]` via `projector.ts`. The projector pairs `tool_call` content blocks with their `tool_result` blocks by `toolCallId`. Transcript renders each pair through `<ToolBlock />`.

S0069 ships **only** `DefaultJsonBlock`. Specialized blocks (Read / Glob / Grep / Edit / Write / Bash / TodoWrite) are S0070.

Adding a new tool renderer in any future spec is one line: `registerToolBlock("MyTool", MyToolBlock)` in module init. Main rendering path unchanged.

### 10. Streaming IPC channel (forward-compatible)

Add channels and types so S0070 can light up streaming without another IPC pass:

`apps/gui/src/shared/ipc.ts`:

```ts
export type GuiSessionEventPayload = {
  sessionId: SessionId;
  event: ScorelEvent;
};

export const guiIpcChannels = {
  ...,
  attachSession: "scorel:attachSession",   // (project, sessionId) → void
  detachSession: "scorel:detachSession",   // (sessionId) → void
  sessionEvent:  "scorel:sessionEvent",    // main → renderer push
} as const;

export type GuiApi = {
  ...,
  attachSession(project: GuiProjectRef, sessionId: SessionId): Promise<void>;
  detachSession(sessionId: SessionId): Promise<void>;
  onSessionEvent(handler: (payload: GuiSessionEventPayload) => void): () => void;
};
```

`apps/gui/src/main.ts` keeps a `BrowserWindow` reference. On `attachSession`, look up the relevant `DaemonClient` and call `client.subscribe((event) => webContents.send("scorel:sessionEvent", { sessionId, event }))`; remember the unsubscribe by `sessionId`. On `detachSession`, run the saved unsubscribe.

`local-host.ts` and `relay-service.ts` expose internal `getClient()` / `subscribe(sessionId, handler)` helpers; no domain logic moves there.

`sendMessage` semantics narrow: it **starts** the prompt and resolves with `{ accepted: true }` once the daemon accepts. Live events arrive via the channel push. Renderer must `attachSession` before calling `sendMessage` (Transcript mounts → attach → send → receive events → unmount → detach).

Renderer behavior in S0069: attach + receive `PersistentEvent` snapshots and push them through the projector each frame (no batching, no cursor). Transient events (`text_delta` etc.) are ingested by the projector but not visualized — S0070 lights them up.

### 11. esbuild build script

`apps/gui/scripts/build.mjs`:

- entry `src/renderer/main.tsx` (was `src/renderer.tsx`).
- add CSS loader: import `./styles.css` from `main.tsx`, esbuild bundles it to `.dist/renderer.css`. `index.html` adds `<link rel="stylesheet" href="renderer.css">`.

### 12. package.json

Add to `apps/gui/package.json` dependencies:

```
"lucide-react": "^0.488.0"
"react-markdown": "^10.1.0"
"remark-gfm": "^4.0.1"
"rehype-sanitize": "^6.0.0"
"shiki": "^4.1.0"
"@shikijs/rehype": "^4.1.0"
```

Versions match `apps/webui/package.json`.

---

## Non-Goals

- No streaming cursor, RAF batcher, IntersectionObserver autoscroll, jump-to-bottom button. (S0070.)
- No specialized tool blocks (Read / Glob / Grep / Edit / Write / Bash / TodoWrite). All routes go through `DefaultJsonBlock`. (S0070.)
- No diff viewer. (S0070.)
- No model picker / 🎤 / `完全访问` real toggling. Disabled placeholders only.
- No dark-mode implementation (placeholder block only).
- No `react-router`. View-mode switch is local React state.
- No WebUI changes. Reverse-reuse of GUI components in WebUI is a future product direction, not a S0069 deliverable.
- No new Electron menu, no auto-update, no installer packaging.
- No new Host / Daemon / Relay / Protocol package change beyond the additive IPC channels.
- No removal of any existing IPC handler. `sendMessage` keeps responding (now with `{ accepted: true }` ack), so any callers staying on the old polling shape (none in this repo) would still build.

---

## Acceptance Criteria

- `apps/gui/src/renderer.tsx` deleted; `apps/gui/src/renderer/main.tsx` is the entry.
- `apps/gui/src/index.html` has no `<style>` block; layout/colors come from `renderer.css`.
- Empty state matches image3: H1 reads `我们应该在 {project.displayName} 中做些什么?` (project-aware, falls back to `我们应该构建什么?` when no project resolves), pill composer, project picker pill below, no recommendation cards, no topbar title.
- Project picker overlay matches image4: search box, list with current `✓`, `添加本地项目` and `添加远程项目` rows, no "不使用项目".
- Add Remote Project modal matches image5: host dropdown, path input + reset, directory listing, footer hint, cancel / add buttons.
- Sidebar matches image6: 4 fixed action rows on top, project list with each project's sessions inline-expanded under it; collapse persists.
- Sidebar bottom shows only `⚙ 设置` (mobile icon kept). No theme toggle row, no "对话" history group.
- Settings is an in-renderer view: `⚙ 设置` switches to settings, back button restores workspace. Relay Devices section reproduces existing pair / refresh / device-list functionality.
- Markdown rendering visible in transcript: GFM tables, code blocks with Shiki highlight (lazy), sanitized HTML (no script execution).
- Tool calls render via `ToolBlock`: with `DefaultJsonBlock`, both `tool_call.args` and `tool_result.result` shown as fenced JSON. `ReadBlock` etc. registered as `DefaultJsonBlock` (visual identity), confirming the registry path is wired.
- IPC channels `attachSession` / `detachSession` / `sessionEvent` exposed via `window.scorel`, exercised by `Transcript` mount/unmount.
- `sendMessage` returns `{ accepted: true }` shape; renderer no longer awaits a `PersistentEvent[]` from it.
- All existing existing local + Relay project flows continue to function: add local project (via picker), add Relay device (via Settings), add remote project (via picker → modal), open session, send prompt, receive response.
- Lucide icons used everywhere they appear in screenshots; no Unicode-character icons remain in the renderer source.

---

## Test Requirements

```bash
pnpm --filter @scorel/app-gui build
pnpm --filter @scorel/app-gui typecheck
pnpm --filter @scorel/app-gui test
pnpm typecheck
pnpm test
pnpm pack:smoke
git diff --check
```

Manual e2e:

- `pnpm --filter @scorel/app-gui dev` launches Electron.
- Visual diff against image2-6 for sidebar, empty state, picker overlay, add-remote modal, settings.
- Real provider single-prompt smoke: open existing local project, create new session, send a prompt that triggers at least one tool call, see `DefaultJsonBlock` render the tool_call/tool_result pair, see assistant text rendered as Markdown.
- Settings flow: pair a Relay device, refresh, add remote project via picker → modal, send prompt against remote, confirm response.

Existing automated suites under `apps/gui/src/main/*.test.ts` and any `verify:m9-gui` pipeline continue to pass.

---

## Affected Paths

- `apps/gui/src/renderer.tsx` — deleted.
- `apps/gui/src/renderer/**` — new tree.
- `apps/gui/src/index.html` — strip inline `<style>`, add stylesheet link, point script at `renderer.js` (unchanged build artifact name).
- `apps/gui/src/main.ts` — add `BrowserWindow` reference for `webContents.send`, attach/detach handlers, narrowed `sendMessage` ack.
- `apps/gui/src/preload.ts` — expose new channels.
- `apps/gui/src/shared/ipc.ts` — channels, types, narrowed `GuiApi.sendMessage` return type.
- `apps/gui/src/main/local-host.ts` — `subscribe(sessionId, handler)` helper; `sendLocalMessage` no longer awaits all events.
- `apps/gui/src/main/relay-service.ts` — same shape.
- `apps/gui/scripts/build.mjs` — entry rename + CSS loader.
- `apps/gui/package.json` — new deps.
- `docs/ROADMAP.md` — append M9 Follow-up section listing S0069 / S0070.
- `docs/spec/ship/S0069-gui-codex-ui-refactor.md` — this file.

---

## Implementation Notes

- `projector.ts` and `delta-batch.ts` are copied from `apps/webui/lib/events/` verbatim, then the Tailwind / Next-specific assumptions are stripped. Follow-up product direction (rebasing WebUI onto GUI components) is out of scope here.
- `Markdown.tsx` sanitize schema mirrors `apps/webui/components/chatbox/markdown-view.tsx` to reuse the audit done there. Any deviation is recorded in this spec.
- Tool block registry registration happens in `apps/gui/src/renderer/chatbox/tool-blocks/registry.ts` module init: `registerToolBlock("Read", DefaultJsonBlock)` etc. for now. S0070 swaps the right-hand side to specialized components without touching `Transcript.tsx`.
- Sidebar `+` button placement: header row of the PROJECTS section keeps a small `+` (lucide `Plus`) for fast add (user decision: dual-entry). Same handler as picker overlay's `添加本地项目`.
- `EmptyState.tsx` resolves the H1 project name by reading the active picker selection. Falls back to the brand-neutral question when the active selection has no `displayName`.
- `Topbar.tsx` renders only the right-side stack icon (matches image3). When a session is open it can also display the session title left-aligned (image2). No 64px row, no dividing border.
- `useCollapsed("project:{projectKey}")` is the single hook for ProjectTree expansion. Default state: collapsed = false (expanded) for the active project on first load, collapsed = true for others. Persistence is best-effort, missing key = expanded.

---

## Risks

- IPC reshape: existing `sendMessage` contract change (Promise<PersistentEvent[]> → Promise<{ accepted: true }>) is a breaking renderer-side change. Acceptable because GUI and renderer ship together and are not pre-1.0.
- Adding lucide-react / react-markdown / shiki to GUI bundle increases renderer size; verified against build smoke.
- Shiki lazy load in Electron renderer must not assume CDN — same `createHighlighterCore` + bundle-shipped grammar approach as webui.
- `tool-blocks/registry` must not introduce a circular import. Keep registration module a leaf; `Transcript.tsx` imports `lookupToolBlock`, registry imports nothing renderer-specific beyond `Default*Block`.
- `webContents.send` from main with high-frequency events (`text_delta`) can saturate IPC. S0069 only forwards `PersistentEvent`; transient flooding is S0070's concern (RAF batcher solves it).

---

## Out Of Scope (Reaffirmed)

Codex screenshot elements explicitly excluded:

- empty-state plugin recommendation cards.
- bottom-sidebar global "对话" history group.
- composer review banner (`2 个文件已更改 +95 -1` / `审查`).
- "不使用项目" picker option.
- functional model picker / mic / "完全访问" toggle.
