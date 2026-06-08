# S0071: GUI Visual Fidelity Refit And Settings macOS Shell

## Goal

Bring `apps/gui` visual quality up to the Codex App reference screenshots (image2–image7). M9 Follow-up shipped structure + streaming + tool blocks (S0069/S0070), but acceptance was structural — type/test only, no visual diff. Net result: all the right pieces are present, none of them look right.

This spec closes the visual gap in two scopes, no new product surface:

1. **Global visual refit** — rewrite tokens + per-component CSS so sidebar, topbar, composer, empty state, project picker overlay, transcript, tool blocks, and markdown match the Codex aesthetic.
2. **Settings macOS shell** — rebuild `renderer/settings/` as a two-pane macOS-style settings window matching image7: left nav with grouped sections, header (back / device selector / search), right card surface with row-based controls (label+desc / dropdown / toggle / link / button).

Reference screenshots:

- image2 — populated session: hero title 600 weight, action chips with leading icons, composer with bottom mini pill.
- image3 — empty: H1 32px / weight 500 / center, composer pill 24 radius, project picker mini pill below composer.
- image4 — picker overlay: 8px round, 1px hairline, soft surface backing, leading 16px folder icons, divider before add rows.
- image5 — Add Remote Project modal: card 16 radius, host dropdown native chevron, path input + reset, directory list with folder icons, primary CTA black.
- image6 — sidebar: warm gray surface, project rows compact, inline sessions slightly indented, online dot tight to label.
- image7 — settings: left nav 256px with `个人 / 集成 / 编码` section captions, active row raised white with 1px hairline, right pane card-grouped rows with right-aligned controls, blue link `了解更多`, blue toggle, red destructive CTA.

---

## Scope

### 1. Token reset

Update `apps/gui/src/renderer/styles.css` `:root`:

```
--color-bg:               #FFFFFF;
--color-surface:          #F5F5F5;     /* sidebar / settings nav */
--color-surface-soft:     #FAFAFA;     /* card body in settings */
--color-surface-hover:    #ECECEE;
--color-surface-raised:   #FFFFFF;     /* active sidebar / picker overlay backing */
--color-border:           #E4E4E7;
--color-border-hairline:  #EFEFEF;
--color-border-strong:    #D4D4D8;
--color-text:             #0D0D0D;
--color-text-muted:       #5D5D5D;
--color-text-faint:       #9CA3AF;
--color-accent:           #0D0D0D;
--color-accent-soft:      #F0F0F2;
--color-link:             #2563EB;     /* settings link, toggle */
--color-status-warn:      #F0712C;     /* composer "完全访问" warn chip */
--color-status-err:       #DC2626;
--color-status-ok:        #16A34A;
--color-status-idle:      #9CA3AF;

--shadow-ring:            inset 0 0 0 1px var(--color-border);
--shadow-ring-strong:     inset 0 0 0 1px var(--color-border-strong);

--radius-sm:   6px;
--radius-md:   10px;
--radius-lg:   14px;
--radius-pill: 24px;
--radius-full: 9999px;

--text-xs:   12px;
--text-sm:   13px;
--text-base: 14px;
--text-md:   15px;
--text-lg:   18px;
--text-xl:   24px;
--text-hero: 32px;
```

Sidebar width drops 280 → 264. Empty-state H1 uses `--text-hero` 32px / weight 500 / letter-spacing -0.018em.

### 2. Sidebar visual refit

`renderer/shell/Sidebar.tsx` + `ProjectTree.tsx` + `styles.css`:

- Background `--color-surface` (#F5F5F5), no border-right separator (use 1px hairline color match instead).
- Section caption: 11px / 600 / uppercase / tracking 0.06em / `--color-text-faint`, sits 16px below preceding block, 6px above first row.
- Row paddings: 6/10. Active row: `--color-surface-raised` + `--shadow-ring`. Hover row (non-active): `--color-surface-hover`. No `--surface-hover` on active.
- Project row layout: `[14 caret] [16 folder icon, color text-faint] [name flex] [8 right-pad] [8 online-dot]`. Drop the redundant secondary-name line — when relay device is bound, render the device label as smaller muted line under name only when project displayName != device label (avoid duplicate text).
- Online dot: 6×6, `--color-status-ok` or `--color-status-idle`, no border.
- Session row: indent 26 (caret column + 12 gap), 4/8 padding, font 13 / weight 400, muted color in inactive, full text on active. No icon.
- Bottom `设置` row: same row geometry, no trailing mobile icon (trailing reserved for future hot-key chip).
- Top action rows: `+ 新对话` keeps icon 14, label 13, hover `--color-surface-hover`. `搜索 / 插件 / 自动化` rows render disabled with 0.42 opacity but no `cursor: not-allowed` if it visually breaks the row — rely on the system pointer.

### 3. Topbar refit

`renderer/workspace/Topbar.tsx`:

- Height 44 → 40. Padding `16 18 0`.
- Title 14 / 600 with 1.4 line-height (was 600 default font weight chunk).
- Right: drop the unused `PanelRight` placeholder. Keep error/host-message inline as 12 muted/err text.
- No bottom border. The transcript inner already has its own first-row spacing.

### 4. Composer + picker pill refit

`renderer/composer/Composer.tsx` + `ProjectPickerPill.tsx`:

- Composer pill: padding `14 18 12`, `border-radius: 24`, hairline border, no surface fill.
- Textarea: min-height 44, max-height 200, font-size 15 / line-height 1.55, placeholder color `--color-text-faint`.
- Bar row: 36 height, gap 10. Left group: `+` icon button 28px circle, then `完全访问` chip — render as `<AlertTriangle 12> 完全访问 <ChevronDown 12>` in `--color-status-warn`, weight 600, font-size 13, hover `--color-surface-hover` 6px radius pill, padding `4 8`.
- Right group: `5.5 超高 ⌄` chip — 13 / 600 / `--color-text` / hover surface-hover. Mic 16. Send 32×32 black circle with `ArrowUp 14` white. While `inFlight`, swap to `--color-status-err` circle with `Square 12`.
- Project picker pill (below composer): align-self start, `[Folder 14] {name} [ChevronDown 14]`, 13 / 500, `--color-text`, hover `--color-surface-hover`, padding `4 10`, radius full. Sits 8px below composer, NOT inside the form.

### 5. Empty state refit

`renderer/workspace/EmptyState.tsx`:

- Wrapper grid: `auto 1fr`, content vertically centered with 8vh bottom offset.
- H1: 32 / 500, letter-spacing -0.018em, max-width 680, center.
- Composer-shell width: `min(720px, 100%)`.
- Picker pill 12px below composer.
- Drop the `composer-shell` `gap` — replaced with explicit margins to control composer ↔ pill rhythm.

### 6. Project picker overlay refit

`renderer/composer/ProjectPickerMenu.tsx`:

- Backdrop: `rgba(15, 15, 15, 0.18)` (was 0.16) with 4px blur — keeps focus on overlay without a hard scrim.
- Popover: 320 wide, `--color-surface-raised` background, `--shadow-ring`, radius 12, padding 6, gap 2. Position centered for now (until anchored placement is wired) — no inline `Search` icon nested inside a composer-pill class (current bug). Search input is a clean rounded-sm input with leading icon.
- Search input: 32 height, `--color-surface` fill, hairline border, `--color-text` text.
- Item row: 30 height, `[16 icon] [label flex] [16 trailing]`, padding `4 8`, radius 6. Hover `--color-surface-hover`. Selected check sits in trailing slot.
- Divider: 1px hairline, 6px vertical margin.
- `添加本地项目` / `添加远程项目` rows below divider use `FolderPlus` and `Globe` 14px leading icons, no chevron suffix.
- `不使用项目` remains explicitly out of scope.

### 7. Add Remote Project modal refit

`renderer/composer/AddRemoteProjectDialog.tsx`:

- Backdrop: `rgba(15, 15, 15, 0.32)` plus 4px blur.
- Panel: 520 wide, radius 16, padding 24 24 20, gap 14.
- Header: 18 / 600 title, 14 muted subtitle on its own row.
- Field label: 12 / 500 muted, 6 below input.
- Inputs/select use 36 height, 8 radius, hairline border, `--color-bg` fill, `--color-text`.
- Reset button: 28 icon button, no border, hover surface-hover.
- Directory list row: 28 height, `[Folder 14] {name}` 13, hover surface-hover, radius 6.
- Footer buttons: `取消` ghost (transparent, hover surface-hover), `添加项目` primary (`--color-accent` bg, white text, 36 height, padding `0 16`, 8 radius).

### 8. Transcript / turn refit

`renderer/chatbox/TurnUser.tsx` + `TurnAssistant.tsx` + tool block CSS:

- User bubble: max-width 70%, radius 14, `--color-accent-soft` bg, padding `10 14`, font 15 / 1.55. Margin 0 (rely on transcript gap).
- Assistant article: no border, no padding x. Margin 0. Streaming cursor sits at trailing edge of last text part.
- Transcript inner: width `min(720px, 100%)`, gap 22.
- Markdown: paragraph margin-bottom 10, h2 mt 18 mb 8, h3 mt 14 mb 6, list margin-bottom 10, table border-color `--color-border-hairline`, code block `--color-surface` bg, font-mono 13.

### 9. Tool block chip rebuild

Tool blocks currently render as bordered cards. Codex aesthetic is **chip-style action lines**: 14 height row, leading 14 icon, single-line title, optional collapsed body.

Update `renderer/chatbox/tool-blocks/*` (CSS only on most, structural on a few):

- New CSS class `tool-chip` replacing `tool-block` for the closed state:
  - row: `[16 icon] [label flex 13/500/text-muted] [12 chevron]`.
  - no border, no background, padding `2 0`, hover changes label color to `--color-text` (no background swap).
- Open state shows a body block below: 1px left rule (`box-shadow: inset 2px 0 0 var(--color-border)`), padding `6 0 6 12`, font 12 muted.
- `ReadBlock` chip: `已读取 {basename(path)}{range?}`. Body collapsed by default — when open, show full file_path on first line and read range on second.
- `GlobGrepBlock` chip: `已搜索 "{pattern}"` for Grep, `已探索 N 个文件` for Glob (drop `· N 个匹配` from chip; show count in body header).
- `EditWriteBlock` chip: `已编辑 {basename(path)}` or `已创建 {basename(path)}` followed by `+N -M` colored counters as right-aligned secondary text. Body keeps unified diff (already implemented).
- `BashBlock` chip: `$ {truncate(command, 64)}`. Body unchanged.
- `TodoWriteBlock` stays as a non-collapsing card (it IS the content), but switch to chip-style header `任务 ({done}/{total})` and inline list with 12px checkbox icon column. Drop the explicit border around the whole card; rely on transcript gap and a 1px left rule on open items.
- `DefaultJsonBlock` chip: `{toolName}{pending?" · pending":""}`.

### 10. Settings macOS shell

Replace `renderer/settings/SettingsPage.tsx` + `RelayDevicesPanel.tsx` with a tree:

```
renderer/settings/
├── SettingsShell.tsx     # grid: nav 256 / main
├── SettingsNav.tsx       # back row + device selector + search + sectioned items
├── SettingsHeader.tsx    # H1 + subtitle + optional 了解更多 link
├── SettingsCard.tsx      # white card container, divider per child row
├── SettingsRow.tsx       # [label + desc] [trailing control]
├── controls/
│   ├── Toggle.tsx        # 28×16 pill, blue when on
│   ├── Select.tsx        # native <select> styled to look like macOS button with chevron
│   └── LinkAccent.tsx    # blue inline link with optional trailing arrow icon
└── sections/
    ├── GeneralSection.tsx
    ├── AppearanceSection.tsx
    ├── ConfigSection.tsx        # contains Relay URL + pair + device list (was RelayDevicesPanel content)
    ├── PersonalizationSection.tsx
    ├── KeyboardSection.tsx
    ├── UsageSection.tsx
    ├── McpSection.tsx
    ├── ConnectionsSection.tsx
    └── GitSection.tsx
```

Section list (matches image7 ordering):

- Group `个人`: 常规 / 个人资料 / 外观 / 配置 / 个性化 / 键盘快捷键 / 使用情况和计费.
- Group `集成`: 应用快照 / MCP 服务器 / 浏览器 / 电脑操控.
- Group `编码`: 钩子 / 连接 / Git / 环境.

**Only `配置` (Config) and `常规` (General) ship real content in S0071.** Others render `SectionPlaceholder` with title + 14 muted "待开发" hint. Acceptance is the macOS shell + nav + Config section functionality, not 14 fully-built sections.

#### 10.1 SettingsNav

- 256 wide, `--color-surface` background.
- Top: `← 返回应用` row 32 height, hover surface-hover.
- Below back row: device selector — `[Monitor 14] 此电脑 [ChevronDown 12]` styled as a dropdown trigger 36 height, padding `0 10`, radius 8, surface-soft fill, hairline border. Disabled placeholder for S0071 (only "此电脑" exists). Native `<select>` underlying so future devices light it up without UI work.
- Search input: 32 height, `--color-surface-soft` fill, hairline border, leading `Search 13`. Currently a no-op visual that filters nav items by label substring (S0071: nav-only filter).
- Group caption: 11 / 600 muted-faint uppercase, padding `12 12 4`.
- Item row: 30 height, padding `4 10`, radius 8, gap 10, font 13. Active = `--color-surface-raised` + `--shadow-ring`. Hover = `--color-surface-hover`. Active wins over hover.

#### 10.2 SettingsHeader

- H1 24 / 500, sub 13 muted, `了解更多` rendered as `<LinkAccent>`.
- Sits inside main pane top, padding `28 32 8`.

#### 10.3 SettingsCard / SettingsRow

- Card: `--color-surface-raised` (#FFFFFF), `--shadow-ring`, radius 12, no shadow. Children stacked vertically with 1px inner divider (`box-shadow: inset 0 -1px 0 var(--color-border-hairline)` on each row except last).
- Row: `[grow: label 14/500 + desc 12 muted] [shrink: control]`, padding `12 16`, min-height 56.

#### 10.4 ConfigSection

S0071 fold the existing Relay device functionality into the Config section:

- Card 1 — `自定义 config.toml 设置` (placeholder; toml editing out of scope).
  - Profile select (placeholder): `用户配置 ▾`, with ghost link `打开 config.toml ↗` aligned right.
  - Row `批准策略 / 选择何时请求批准` + Select(`从不 / 失败时 / 始终`) — disabled in S0071.
  - Row `沙盒设置 / 选择命令执行权限` + Select(`完全访问 / 工作区写入 / 只读`) — disabled.
- Card 2 — `Relay Devices` (real, replaces old RelayDevicesPanel).
  - Row `Relay URL` with input control (right side) + small `Pair` button.
  - Row `已配对设备` with `Refresh` button trailing; below the row, render the device list as nested rows (no separate card) showing label, online dot, relay URL muted.
  - When pair code present, render as a sub-card hint with the 6-digit code.

#### 10.5 GeneralSection

- Card — `外观` (theme).
  - Row `主题 / 跟随系统、亮、暗` + Select disabled, defaults `跟随系统`.
- Card — `语言`.
  - Row `语言` + Select disabled, defaults `中文`.

These are placeholders that look real but do nothing — keeps the nav from feeling empty without scope creep.

### 11. Sidebar settings entry

Sidebar bottom `设置` row keeps its place. Drop the trailing mobile icon. Click switches workspace → settings, settings header back row switches back. Same as before, just visual cleanup.

### 12. Files affected

```
apps/gui/src/renderer/styles.css                           # token reset + class rewrites
apps/gui/src/renderer/shell/Sidebar.tsx                    # tweaks
apps/gui/src/renderer/shell/ProjectTree.tsx                # row layout
apps/gui/src/renderer/workspace/Topbar.tsx                 # drop PanelRight, height
apps/gui/src/renderer/workspace/EmptyState.tsx             # H1 + spacing
apps/gui/src/renderer/composer/Composer.tsx                # pill spacing + chip refits
apps/gui/src/renderer/composer/ProjectPickerPill.tsx       # geometry
apps/gui/src/renderer/composer/ProjectPickerMenu.tsx       # overlay rebuild
apps/gui/src/renderer/composer/AddRemoteProjectDialog.tsx  # field + button refit
apps/gui/src/renderer/chatbox/TurnUser.tsx                 # bubble
apps/gui/src/renderer/chatbox/TurnAssistant.tsx            # spacing
apps/gui/src/renderer/chatbox/Transcript.tsx               # gap + width
apps/gui/src/renderer/chatbox/tool-blocks/*.tsx            # chip rewrite
apps/gui/src/renderer/settings/SettingsPage.tsx            # DELETED
apps/gui/src/renderer/settings/RelayDevicesPanel.tsx       # DELETED
apps/gui/src/renderer/settings/SettingsShell.tsx           # NEW
apps/gui/src/renderer/settings/SettingsNav.tsx             # NEW
apps/gui/src/renderer/settings/SettingsHeader.tsx          # NEW
apps/gui/src/renderer/settings/SettingsCard.tsx            # NEW
apps/gui/src/renderer/settings/SettingsRow.tsx             # NEW
apps/gui/src/renderer/settings/controls/Toggle.tsx         # NEW
apps/gui/src/renderer/settings/controls/Select.tsx         # NEW
apps/gui/src/renderer/settings/controls/LinkAccent.tsx     # NEW
apps/gui/src/renderer/settings/sections/*.tsx              # NEW (9 sections, 7 placeholders + 2 real)
apps/gui/src/renderer/App.tsx                              # mount SettingsShell instead of SettingsPage
apps/gui/src/renderer/icons/index.ts                       # add Monitor, ArrowUpRight if missing
docs/ROADMAP.md                                            # add M9.F1.3 row + Active Specs row
docs/spec/ship/S0071-gui-visual-fidelity-and-settings-shell.md   # this file
```

---

## Non-Goals

- No new product features. No real toggling of `完全访问`, model picker, mic, theme, language, sandbox setting, or approval policy — all stay disabled placeholders or pure-visual selects.
- No anchored / floating-ui-style positioning for the picker overlay; centered overlay continues. Anchored placement is a follow-up if needed.
- No native macOS vibrancy / transparency effects. Solid surfaces only.
- No light/dark theme — single light theme; dark deferred.
- No new IPC channels.
- No webui changes.
- No `不使用项目`, no plugin recommendation cards, no review banner, no global `对话` history group (re-affirmed from S0069).
- No scroll-spy / search-jump in settings — search filters nav items by label substring only.
- No real config.toml parsing or editing.

---

## Acceptance Criteria

- Side-by-side visual diff against image2 / image3 / image6 / image7: layout proportions, type weight, spacing, color usage, chip styles, card geometry match within visual tolerance (no pixel-perfect requirement, but no obviously wrong typeface weight, padding, or color).
- Sidebar uses warm gray surface, sectioned project rows with inline sessions, active row reads as raised white card via inset ring (not surface-hover), no double-icon clutter on project rows.
- Composer pill matches image3: 24 radius, hairline border, warn-orange `完全访问` chip, black 32 send circle.
- Empty H1 reads as `我们应该在 {project} 中做些什么？` at 32px / 500 / center, with composer below at min(720, 100%) and project picker mini pill 12px below composer.
- Project picker overlay matches image4 visually: rounded card, hairline ring, leading 14 icons, divider, add-local / add-remote rows.
- Add Remote Project modal matches image5 visually: 520 panel, host select, path input + reset, directory list, footer cancel + black primary.
- Settings view matches image7: 256 nav, three caption groups, active item raised white, header with back / device selector / search input, right pane card-grouped rows. `配置` section opens by default and shows Relay URL + Pair + device list folded into the Codex-style card layout (toml settings rows are visual-only placeholders, but render with correct geometry).
- Tool blocks render as inline chip rows with leading icon, not bordered cards, except `TodoWriteBlock`.
- Markdown table borders, code block tint, paragraph spacing match the refit values above.
- All previously-working flows still work: add local project, send message, attach session, stream tokens, render specialized tool blocks, pair Relay device, refresh, add remote project, navigate sessions, switch settings ↔ workspace.

---

## Test Requirements

```
pnpm --filter @scorel/app-gui build
pnpm --filter @scorel/app-gui typecheck
pnpm --filter @scorel/app-gui test
pnpm typecheck
pnpm test
pnpm pack:smoke
git diff --check
```

Manual visual e2e (`pnpm --filter @scorel/app-gui dev`):

- Compare each surface against the matching reference screenshot.
- Settings: open every section in the nav; confirm placeholders render geometry without errors; confirm `配置` Relay URL / Pair / Refresh / device list still functions through the IPC path.
- Send one prompt that triggers Read + Edit + Bash + TodoWrite tool calls; confirm chip-style rendering and that opening a chip reveals body content.

No new automated tests are required beyond the existing `local-host`, `relay-service`, `gui-store`, `package-boundaries`, and `diff` suites continuing to pass. Visual fidelity is acceptance-by-eye.

---

## Implementation Notes

- Token reset is the high-leverage change. Most "ugly" feedback on the current build comes from wrong neutrals (border too dark, surface too gray, raised state indistinguishable from hover) and wrong type sizes (H1 30 with default tracking, sidebar 13 muted across all rows). Hit those first.
- Where current Tailwind-flavored class names live in copied webui files (e.g. inside markdown components or shiki block), keep the renames lightweight: prefer extending plain class names defined in `styles.css` rather than inline styles. Inline styles are acceptable for one-off layout tweaks.
- `Select.tsx` wraps a native `<select>` so accessibility + keyboard nav come for free. Style the wrapper to look like a macOS popup button (chevron via lucide `ChevronDown`).
- `Toggle.tsx` is a controlled `<button role="switch" aria-checked>` — 28×16 track, 12 thumb, 100ms transform transition. Blue track when on, gray when off. (Animation duration is a hard cap; spec.md design.md disallows shadows but transitions are fine.)
- `SettingsNav` search filters the items array by `item.label.includes(query)`. No fuzzy matching.
- `SettingsShell` keeps view-mode local state (no router, consistent with S0069). Default selected section is `config` (matches image7 active row).
- For tool block chip refit, the visual change is significant but the data shape stays — only `tool-block` CSS plus per-block JSX restructure (icon order, no border container).
- Keep all chip rows accessible: `<button type="button" aria-expanded>` for the chip itself, body wrapped in a region with `aria-hidden` toggled by `open`.

---

## Risks

- Risk: token reset breaks existing component visuals (e.g. transcript-empty). Mitigation: refit goes class-by-class; run `pnpm --filter @scorel/app-gui build` after each major class group.
- Risk: native `<select>` styling diverges across macOS / Linux Electron builds. Mitigation: accept divergence; the Codex App reference is macOS — Linux/Windows users get a slightly different but still functional control.
- Risk: chip refit hides too much info on first render. Mitigation: error states (`isError = true`) auto-expand, matching S0070 behavior.
- Risk: settings nav gains 14 rows of which only 2 work — feels misleading. Mitigation: placeholders render `待开发` muted hint, no fake controls.

---

## Out Of Scope (Reaffirmed)

- Real toml editing.
- Plugin recommendation cards.
- Bottom sidebar global "对话" history group.
- Composer review banner.
- "不使用项目" picker option.
- Functional model / mic / 完全访问 toggles.
- Dark mode.
- Reverse-reuse of GUI components in webui.
- SSH / direct WS + token / HTTP API.
