# S0044: WebUI Chatbox-Style Rebuild (ChatGPT Philosophy)

## Goal

Rebuild the entire WebUI surface to a Chatbox-style three-segment sidebar with ChatGPT-philosophy visuals: pure white background, near-black text, single-axis accent, sans-only typography, no shadows, no decorations. Replaces M5.5's warm-paper + ink-blue + Newsreader serif baseline (S0040–S0042) wholesale. Adds project-node collapse, pill composer, and Codex-style disabled placeholder buttons for unimplemented features.

Locked decisions live in `self/discussions/2026-05-31-webui-chatbox-rebuild-brainstorm.md` §5 and `docs/design.md`. This spec is the implementation contract.

Mood board (user-supplied screenshot):

- Sidebar three segments: top fixed actions (`+ New Chat` active, Search/Plugins/Automation grayed) → middle device/project tree with per-project ▸/▾ collapse → bottom Settings + grayed theme toggle.
- Main area: **no topbar**. Empty state shows large H1 greeting; populated state shows transcript only.
- User turn: max-width 70%, right-aligned, soft-gray bubble (`#F4F4F4`), 16px radius. Assistant turn: no bubble, flush against `bg`, left-aligned.
- Composer: pill with 24px radius, 1px `#E7EAEC` border, `⊕` left, `model ▾` + `🎤` + circular `●` send right. All non-send buttons grayed (Codex semantic).

---

## Scope

### 1. Tokens — `apps/webui/app/globals.css`

Replace every `:root` value (S0040 Codex palette) with the ChatGPT palette. **Variable names stay**, only values change, so all `bg-surface` / `text-muted` / etc. semantic classes flow through automatically. Final `:root`:

```css
:root {
  /* color */
  --color-bg:             #FFFFFF;
  --color-surface:        #F7F7F8;   /* sidebar / popover */
  --color-surface-raised: #FFFFFF;   /* composer / modal */
  --color-surface-hover:  #EFEFF1;   /* hover reaction (NEW token) */
  --color-border:         #E7EAEC;
  --color-border-strong:  #9CA3AF;
  --color-text:           #0D0D0D;
  --color-text-muted:     #5D5D5D;
  --color-text-faint:     #9CA3AF;   /* placeholder / disabled */
  --color-accent:         #0D0D0D;   /* send / active emphasis = black */
  --color-accent-hover:   #1F1F1F;
  --color-accent-soft:    #F4F4F4;   /* user bubble */
  --color-status-ok:      #16A34A;
  --color-status-warn:    #D97706;
  --color-status-err:     #DC2626;
  --color-status-idle:    #9CA3AF;

  /* typography — sans-only */
  --font-body: -apple-system, BlinkMacSystemFont, "PingFang SC",
               "Segoe UI", "Helvetica Neue", system-ui, sans-serif;
  --font-mono: ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace;
  /* --font-display REMOVED — no serif anywhere */

  /* sizes — locked five-step ladder */
  --text-xs: 12px;  --leading-xs: 17px;
  --text-sm: 13px;  --leading-sm: 20px;
  --text-base: 14px; --leading-base: 21px;
  --text-md: 16px;  --leading-md: 26px;   /* conversation body */
  --text-lg: 20px;  --leading-lg: 26px;   /* markdown h2/h3 */
  --text-xl: 30px;  --leading-xl: 36px;   /* empty-state H1 */

  /* spacing — unchanged */
  --space-1: 4px; --space-2: 8px; --space-3: 12px; --space-4: 16px;
  --space-5: 20px; --space-6: 24px; --space-8: 32px;

  /* radius */
  --radius-sm:   6px;
  --radius-md:   12px;
  --radius-lg:   16px;   /* user bubble */
  --radius-pill: 24px;   /* composer */
  --radius-full: 9999px; /* circular send / icon button */

  /* shadow — disabled globally */
  --shadow-sm:   none;
  --shadow-md:   none;
  --shadow-focus: none;
}
```

Remove `--font-display`. Remove `--shadow-*` *values* (set to `none`) but **keep the variable names** so existing `shadow-sm` / `shadow-md` / `shadow-focus` Tailwind utilities don't break the build — they simply render `box-shadow: none`. Components must migrate off `shadow-focus` (see §6).

Remove these CSS rules from `globals.css`:

- `.prose-tweak h1..h4 { font-family: var(--font-display); }` → drop the rule entirely (no serif). Headings inherit `--font-body`.
- The bare `*:focus-visible { box-shadow: var(--shadow-focus); }` block — replace with the new outline-based focus ring (see §6).

Add these new CSS rules:

```css
/* Disabled placeholder buttons (Codex semantic): visible but inert. */
.btn-disabled {
  opacity: 0.4;
  cursor: not-allowed;
  pointer-events: none;
}

/* Empty-state H1 used on `app/page.tsx` and similar landings. */
.greeting {
  font-size: var(--text-xl);
  line-height: var(--leading-xl);
  font-weight: 500;
  color: var(--color-text);
}
```

### 2. Tailwind theme — `apps/webui/tailwind.config.ts`

- Remove `fontFamily.display` (the old Newsreader serif slot).
- Add `colors["surface-hover"]: "var(--color-surface-hover)"`.
- Add `borderRadius.pill: "var(--radius-pill)"` and `borderRadius.full: "var(--radius-full)"`.
- Keep all other mappings as-is. `font-display` referenced anywhere in components must be removed (see §5 sweep).

### 3. Fonts — drop Newsreader

- Remove `@fontsource/newsreader` dependency from `apps/webui/package.json`.
- Drop the two `import "@fontsource/newsreader/*"` lines from `apps/webui/app/layout.tsx`.
- Keep `@fontsource/jetbrains-mono` (still used for `--font-mono`).
- `apps/webui/src/package-boundaries.test.ts`: remove `@fontsource/newsreader` from the allowed externals list. Keep `@fontsource/jetbrains-mono` and the `@fontsource/*` import-prefix rule (if any).

### 4. Layout — drop topbar

- `apps/webui/app/layout.tsx`: remove the `<Topbar />` element. The shell collapses to `<body><Sidebar /><main>{children}</main></body>` with the same flex layout. Body classes: `h-screen flex bg-bg text-text font-sans`. The outer `flex flex-col` wrapper is no longer needed.
- Delete `apps/webui/components/shell/topbar.tsx`.

### 5. Sidebar — three-segment + project collapse

`apps/webui/components/shell/sidebar.tsx` rewrite. Final structure:

```tsx
<aside className="w-[280px] shrink-0 bg-surface flex flex-col">
  {/* Segment 1: top fixed action rows */}
  <div className="px-3 pt-4 pb-2 space-y-1">
    <NewChatRow active={isHomeRoute} />        {/* + New Chat — active, navigates to / */}
    <DisabledRow icon="🔍" label="搜索" />
    <DisabledRow icon="🧩" label="插件" />
    <DisabledRow icon="🤖" label="自动化" />
  </div>

  {/* Segment 2: middle device/project tree */}
  <div className="px-3 pt-4 pb-1 text-xs font-medium uppercase tracking-wide text-faint">
    Devices
  </div>
  <div className="flex-1 overflow-auto px-3 pb-3 text-sm">
    {devices.length === 0 ? <EmptyDevicesHint /> : <ul>{devices.map(d => <DeviceTree … />)}</ul>}
  </div>

  {/* Segment 3: bottom fixed actions */}
  <div className="px-3 py-3 space-y-1">
    <SettingsLink />                           {/* navigates to /settings */}
    <DisabledRow icon="☀" label="主题" />
  </div>
</aside>
```

Row components:

- `NewChatRow`: `<Link href="/">+ 新对话</Link>`. Class: `flex items-center gap-2 rounded-sm px-2 py-2 text-sm font-medium text-text hover:bg-surface-hover`. Active = `bg-surface-hover`. Replaces the existing `NewChatButton` "sidebar" variant; the old component can be deleted if no other route uses it.
- `DisabledRow({ icon, label })`: `<button type="button" disabled className="btn-disabled flex items-center gap-2 rounded-sm px-2 py-2 text-sm text-text">{icon}<span>{label}</span></button>`. Native `disabled` + `.btn-disabled` class composes the Codex semantic.
- `SettingsLink`: `<Link href="/settings" className="flex items-center gap-2 rounded-sm px-2 py-2 text-sm text-muted hover:bg-surface-hover hover:text-text">⚙ Settings</Link>`.

Device row in `DeviceTree`:

- Replace the current `border-l-2 px-2 py-1.5 hover:bg-accent-soft` styling.
- New: `<button type="button" onClick={toggle} className="..."><span>▾/▸</span>{device.name}<DeviceStatus /></button>` followed by `<Link href="/devices/:id" />` semantic — but for simplicity keep it as a single `<Link>` with the `▾/▸` rendered as a sibling `<button>` that toggles collapse without navigating. Concrete pattern:

```tsx
<li>
  <div className="flex items-center gap-1">
    <CollapseToggle id={`device:${device.id}`} />
    <Link href={`/devices/${encodeURIComponent(device.id)}`} aria-current={…} className="…">
      <span className="truncate">{device.name}</span>
      <DeviceStatus />
    </Link>
  </div>
  {!collapsed && <ProjectList … />}
</li>
```

Project row in `ProjectNode` mirrors the same pattern, with `id={`project:${deviceId}/${slug}`}`. Sessions render only when the project is **not collapsed**. The previous "auto-expand if active or sessions.length > 0" rule is removed — collapse state alone drives expansion. Active project starts expanded **on first ever encounter** (default state), but a user collapse persists.

Active row visuals (replaces the old `border-accent bg-accent-soft text-accent` block):

```tsx
const activeClass = isActive
  ? "bg-surface-hover font-medium text-text"
  : "text-text";
```

Drop the 2px left accent border. Sessions: same active style on `SessionNode`.

#### 5.1 Collapse persistence

New module `apps/webui/lib/store/collapsed.ts`:

```ts
const KEY = "scorel.ui.collapsed";

export function readCollapsed(): Record<string, boolean> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(window.localStorage.getItem(KEY) ?? "{}") as Record<string, boolean>;
  } catch {
    return {};
  }
}

export function writeCollapsed(next: Record<string, boolean>): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, JSON.stringify(next));
}
```

New hook `apps/webui/lib/store/use-collapsed.ts`:

```ts
"use client";
import { useSyncExternalStore } from "react";
import { readCollapsed, writeCollapsed } from "./collapsed";

const listeners = new Set<() => void>();
let snapshot: Record<string, boolean> | null = null;

function getSnapshot(): Record<string, boolean> {
  if (snapshot === null) snapshot = readCollapsed();
  return snapshot;
}
function emit(): void { for (const l of listeners) l(); }

export function useCollapsed(id: string): [boolean, () => void] {
  const map = useSyncExternalStore(
    (l) => { listeners.add(l); return () => listeners.delete(l); },
    () => getSnapshot(),
    () => ({}),
  );
  const collapsed = Boolean(map[id]);
  const toggle = (): void => {
    const next = { ...getSnapshot(), [id]: !collapsed };
    snapshot = next;
    writeCollapsed(next);
    emit();
  };
  return [collapsed, toggle];
}
```

`CollapseToggle` component (`apps/webui/components/shell/collapse-toggle.tsx`):

```tsx
"use client";
import { useCollapsed } from "../../lib/store/use-collapsed";

export function CollapseToggle({ id }: { id: string }): JSX.Element {
  const [collapsed, toggle] = useCollapsed(id);
  return (
    <button
      type="button"
      onClick={toggle}
      aria-expanded={!collapsed}
      aria-label={collapsed ? "Expand" : "Collapse"}
      className="text-faint hover:text-text shrink-0 w-4 text-center text-xs select-none"
    >
      {collapsed ? "▸" : "▾"}
    </button>
  );
}
```

### 6. Composer — pill + grayed buttons

`apps/webui/components/chatbox/composer.tsx` rewrite:

```tsx
<form className="px-4 pb-6 pt-3 bg-bg" onSubmit={…}>
  <div className="mx-auto max-w-3xl rounded-pill border border-subtle bg-bg
                  focus-within:border-text-strong focus-within:border-text">
    <textarea
      className="block w-full resize-none bg-transparent px-5 pt-3 pb-1 text-md
                 text-text placeholder:text-faint outline-none"
      placeholder="Message Scorel…"
      value={…} onChange={…} onKeyDown={onKeyDown}
      rows={1} ref={autoResizeRef}
    />
    <div className="flex items-center justify-between px-3 pb-2">
      <button type="button" disabled
              className="btn-disabled rounded-full w-7 h-7 flex items-center justify-center text-text">
        <span aria-hidden>⊕</span>
        <span className="sr-only">Attach</span>
      </button>
      <div className="flex items-center gap-2">
        <button type="button" disabled
                className="btn-disabled rounded-md px-2 py-1 text-sm text-muted">
          {modelLabel} <span aria-hidden>▾</span>
        </button>
        <button type="button" disabled
                className="btn-disabled rounded-full w-7 h-7 flex items-center justify-center text-text">
          <span aria-hidden>🎤</span>
          <span className="sr-only">Voice</span>
        </button>
        {inFlight ? (
          <button type="button" data-testid="composer-cancel"
                  className="rounded-full w-7 h-7 flex items-center justify-center
                             bg-status-err text-bg disabled:opacity-60"
                  onClick={fireCancel} disabled={cancelling}>
            <span aria-hidden>■</span>
            <span className="sr-only">{cancelling ? "Cancelling" : "Cancel"}</span>
          </button>
        ) : (
          <button type="submit" data-testid="composer-send"
                  className="rounded-full w-7 h-7 flex items-center justify-center
                             bg-accent text-bg hover:bg-accent-hover
                             disabled:opacity-40 disabled:cursor-not-allowed"
                  disabled={sendDisabled}>
            <span aria-hidden>↑</span>
            <span className="sr-only">Send</span>
          </button>
        )}
      </div>
    </div>
  </div>
  {errorBanner && <p data-testid="composer-error" role="alert"
                     className="mx-auto max-w-3xl mt-2 text-xs text-status-err">{errorBanner}</p>}
</form>
```

Behavior unchanged:

- Enter submits, Shift+Enter newline, Esc cancels (existing logic in `onKeyDown` preserved).
- `inFlight`/`cancelling`/`onCancel`/`disabled`/`errorBanner` props unchanged.
- New: textarea auto-resizes up to ~5 lines (max-height ~120px) via a small ref-driven height adjust on input. Keep the existing min-height of one line.

`modelLabel` is a new prop with default `"Default"` — Composer caller (chatbox page) passes the active model name when known, else default. Type:

```ts
export type ComposerProps = {
  …,
  modelLabel?: string;
};
```

Caller updates: `apps/webui/components/chatbox/chatbox-page.tsx` (or wherever composer is mounted) — pass through whatever model identifier is available; if none, omit the prop. **Do not introduce new daemon calls** to fetch the model name in this spec.

### 7. Turns — bubble formation

`apps/webui/components/chatbox/turn-user.tsx`:

```tsx
<div className="flex justify-end px-4">
  <article data-testid="turn-user" data-pending={…}
           className="max-w-[70%] rounded-lg bg-accent-soft px-4 py-3 text-md text-text">
    <MarkdownView text={text} />
    {turn.pending && (
      <span className="mt-1 block text-xs text-faint">sending…</span>
    )}
  </article>
</div>
```

Drop the `<header>You · sending…</header>` block — pending state moves to a small footer line. No border, no `font-display`.

`apps/webui/components/chatbox/turn-assistant.tsx`:

```tsx
<article data-testid="turn-assistant" data-streaming={…}
         className="px-4 py-2 text-md text-text">
  {turn.stopReason && turn.stopReason !== "end_turn" && (
    <p className="mb-1 text-xs text-status-warn">{turn.stopReason}</p>
  )}
  <div className="space-y-2">
    {turn.parts.map((part, idx) => <PartView key={idx} part={part} />)}
    {turn.streaming && <StreamingCursor />}
  </div>
</article>
```

Drop the `<header>Assistant</header>` row entirely. No bubble, no border, no surface bg.

`apps/webui/components/chatbox/turn-tool.tsx` and the thinking `<details>` block in `turn-assistant.tsx`:

- Remove `font-display` from the `<summary>`.
- Replace `bg-surface` with `bg-surface` (sidebar gray = ok for visual layering against pure white bg). No change in semantics, just verify the contrast still reads.

`apps/webui/components/chatbox/transcript.tsx`:

- Drop `border-t border-subtle/50` between turns — rely on 24px gap (`space-y-6`).
- Wrap content in `<div className="mx-auto max-w-3xl py-6 space-y-6">` for centered reading column matching ChatGPT.

### 8. Empty state — `app/page.tsx`

When `devices.length === 0`:

```tsx
<div className="flex h-full flex-col items-center justify-center gap-4 p-8">
  <h1 className="greeting">欢迎使用 Scorel</h1>
  <p className="text-md text-muted">先添加一个设备开始</p>
  <Link href="/settings"
        className="rounded-pill bg-accent px-5 py-2 text-bg hover:bg-accent-hover">
    打开 Settings
  </Link>
</div>
```

When devices exist but no active session: similar centered greeting "今天聊点什么?" with no CTA (composer below carries the action).

### 9. Focus ring

Replace the global `*:focus-visible { box-shadow: var(--shadow-focus); }` in `globals.css` with:

```css
*:focus { outline: none; }
*:focus-visible {
  outline: 2px solid var(--color-text);
  outline-offset: 2px;
  border-radius: var(--radius-sm);
}
```

Composer wrapper uses `focus-within:border-text` to flip the pill border to black instead of `outline`. Sweep all `focus-visible:shadow-focus` utility usages across `apps/webui/components/**` and either delete (covered by the global rule) or replace with the same `focus-visible:outline-*` pattern. Remove `--shadow-focus` non-zero value (already `none` in §1).

### 10. Markdown prose tweak — drop serif

`globals.css` `.prose-tweak`:

- Remove the `h1..h4 { font-family: var(--font-display); }` block.
- Verify `--tw-prose-headings` is `var(--color-text)` (already correct).
- Update H1/H2/H3 sizes to match the locked ladder: `prose-tweak h1 { font-size: var(--text-xl); }`, `prose-tweak h2, prose-tweak h3 { font-size: var(--text-lg); }`. Use direct CSS rules in `globals.css` since `@tailwindcss/typography` defaults won't match the ChatGPT scale.
- `prose-tweak p { font-size: var(--text-md); line-height: var(--leading-md); }` — confirm the body math text aligns.
- Inline code: keep current pill styling but switch background to `var(--color-surface)` so it stands out against pure white `bg`.

### 11. Boundary tests — `apps/webui/src/package-boundaries.test.ts`

- Remove `@fontsource/newsreader` from allowed externals.
- Keep the literal-palette ban (zinc/emerald/red/amber/sky/stone/slate/gray). Add `neutral` to the banned list (since ChatGPT-ish UIs sometimes regress to `neutral-*`).
- Add a new rule: scan `apps/webui/{app,components}/**/*.{ts,tsx}` and fail if `font-display` className appears (the serif token is gone). Allow it only inside `*.test.tsx` (excluded from the scan).
- Add a rule: fail if any source file imports `@fontsource/newsreader` (cross-check the package removal).

### 12. Component tests

- `device-status.test.tsx`: status dot tests stay — colors unchanged.
- `topbar.test.tsx` (if it exists): delete the file; topbar is removed.
- Add `collapse-toggle.test.tsx`: render `<CollapseToggle id="x" />`, click, expect `▾` ↔ `▸` swap and `localStorage["scorel.ui.collapsed"]` write.
- Add `sidebar.test.tsx` smoke (or extend existing): render with 1 device + 1 project + 2 sessions; click project toggle; assert sessions hide/show; reload sim (re-render with same `localStorage`); assert collapsed state persists.
- Add `composer.test.tsx` extension or new: assert `data-testid="composer-send"` exists, the three placeholder buttons (`⊕`, `model ▾`, `🎤`) each carry `disabled` attribute and `.btn-disabled` class. Assert `<textarea placeholder="Message Scorel…">`.
- Update `turn-user.test.tsx` / `turn-assistant.test.tsx` if they assert `font-display` or `bg-accent-soft border` — adjust to the new bubble class set.
- All other existing tests should keep passing; if any fails on a removed `font-display` / topbar import, fix the assertion.

---

## Not In Scope

- Dark mode implementation (future spec). Tokens are sized to allow a `prefers-color-scheme: dark` block without component churn.
- Cmd+K / global keyboard shortcuts / command palette.
- Sidebar collapse to 56px icon-only (Cmd+B).
- Composer `+` / `🎤` / model picker real functionality (placeholders only).
- Theme toggle real functionality (placeholder only).
- Tool block specialization (Bash/Edit/diff viewer); keep the unified JSON-fence renderer from S0041.
- Composer prompt history (↑ key recall).
- Streamdown migration; `react-markdown` stays.
- Daemon protocol changes — model name passthrough is best-effort UI display only.
- ROADMAP.md milestone restructure beyond appending `M5.7: WebUI Chatbox Rebuild` and flipping S0044 status.

---

## Acceptance Criteria

1. `apps/webui/app/globals.css` `:root` matches §1 verbatim. No `--font-display` definition. `--shadow-*` set to `none`.
2. `apps/webui/tailwind.config.ts` no longer references `font-display`. New `surface-hover` color, `pill` and `full` border radii.
3. `apps/webui/package.json` no longer contains `@fontsource/newsreader`. `pnpm-lock.yaml` regenerated.
4. `apps/webui/app/layout.tsx` does not import any Newsreader file and does not render `<Topbar />`.
5. `apps/webui/components/shell/topbar.tsx` deleted. No remaining import of it anywhere under `apps/webui/`.
6. Sidebar visibly composed of three segments per §5: top 4 rows (1 active New Chat + 3 grayed), middle device tree with project ▸/▾ collapse, bottom Settings + grayed theme toggle. Tested by `sidebar.test.tsx`.
7. Project / Device collapse state persists to `localStorage["scorel.ui.collapsed"]` and survives a fresh component mount. Tested by `collapse-toggle.test.tsx` and `sidebar.test.tsx`.
8. Composer matches §6: 24px pill, `Message Scorel…` placeholder, three `.btn-disabled` placeholders (`⊕`, `model ▾`, `🎤`), circular black send (white `↑`) / red cancel (white `■`). `inFlight` / `cancelling` / `errorBanner` behavior unchanged. Auto-resize textarea up to 5 lines.
9. User turn renders a right-aligned `max-w-[70%] rounded-lg bg-accent-soft` bubble. Assistant turn renders flush against `bg`, no bubble, no border, no header row. No `font-display` className anywhere in `apps/webui/components/chatbox/`.
10. Empty state on `/` shows the `.greeting` H1 plus CTA when no devices; populated state shows centered greeting without CTA.
11. Focus rings everywhere use the new outline rule (`outline: 2px solid var(--color-text)`). No remaining `focus-visible:shadow-focus` className in source.
12. `apps/webui/src/package-boundaries.test.ts`:
    - `@fontsource/newsreader` removed from allowed externals.
    - `font-display` className ban active and verified.
    - `@fontsource/newsreader` import ban active.
    - Existing literal-palette ban still passes.
13. `pnpm --filter @scorel/app-webui typecheck && pnpm --filter @scorel/app-webui test` passes.
14. `pnpm --filter @scorel/app-webui build` succeeds; bundle reduction (Newsreader removal) noted in PR description.
15. Repo-level `pnpm typecheck && pnpm test` passes.
16. Manual visual verification (browser, after `pnpm dev`):
    - `/` empty state shows greeting + CTA.
    - `/settings` form renders with the new tokens (no warm paper, no serif).
    - `/devices/:id/projects/:slug/sessions/:id` chatbox shows: no topbar, transcript centered (max-w-3xl), user bubbles right-aligned soft-gray, assistant flush left, composer pill at bottom with 4 disabled placeholders + black send.
    - Project node ▸/▾ click toggles session list and persists across page reload.
    - All grayed buttons unclickable (no hover color change, cursor not-allowed).
    - One screenshot of populated chatbox + one of empty state pasted into PR description.
17. CLI-pair smoke: `pnpm dev` (or `scorel up`) → CLI `scorel chat` and WebUI on the same session both show user prompt, assistant streaming, autoscroll, jump-to-bottom, tool block — visual unchanged from M5.5 except for the new palette / structure.

---

## Tests

Adds:

- `apps/webui/components/shell/collapse-toggle.test.tsx` — toggle + persistence.
- `apps/webui/components/shell/sidebar.test.tsx` — three-segment structure + collapse persistence + grayed rows have `disabled` attr + active New Chat highlight.
- `apps/webui/components/chatbox/composer.test.tsx` (or extension) — `Message Scorel…` placeholder, four buttons (3 disabled + 1 send), inFlight swaps to red cancel.

Modifies:

- `apps/webui/components/shell/device-status.test.tsx` — no change unless it tested topbar; verify still green.
- `apps/webui/components/chatbox/turn-user.test.tsx` and `turn-assistant.test.tsx` — adjust class assertions to new bubble shape.
- `apps/webui/src/package-boundaries.test.ts` — three new sub-checks (see §11).

Removes:

- `apps/webui/components/shell/topbar.test.tsx` (if present).

Manual:

- Real LLM e2e against local daemon: `scorel up`, add a device in Settings via WebUI, open `/devices/local/projects/scorel/sessions/<new>`, type `你好`, observe streaming reply, click cancel mid-stream, send another prompt, verify composer pill, sidebar tree collapse, autoscroll. CLI on the same session shows synchronized state.

---

## Affected Paths

- `apps/webui/app/globals.css`
- `apps/webui/app/layout.tsx`
- `apps/webui/app/page.tsx`
- `apps/webui/tailwind.config.ts`
- `apps/webui/package.json` (+ `pnpm-lock.yaml`) — remove `@fontsource/newsreader`
- `apps/webui/components/shell/sidebar.tsx`
- `apps/webui/components/shell/topbar.tsx` — **deleted**
- `apps/webui/components/shell/device-status.tsx`
- `apps/webui/components/shell/project-node.tsx`
- `apps/webui/components/shell/session-node.tsx`
- `apps/webui/components/shell/new-chat-button.tsx`
- `apps/webui/components/shell/collapse-toggle.tsx` — **new**
- `apps/webui/lib/store/collapsed.ts` — **new**
- `apps/webui/lib/store/use-collapsed.ts` — **new**
- `apps/webui/components/chatbox/composer.tsx`
- `apps/webui/components/chatbox/transcript.tsx`
- `apps/webui/components/chatbox/turn-user.tsx`
- `apps/webui/components/chatbox/turn-assistant.tsx`
- `apps/webui/components/chatbox/turn-tool.tsx`
- `apps/webui/components/chatbox/markdown-view.tsx` (verify no `font-display` reference)
- `apps/webui/components/settings/device-form.tsx` / `device-list.tsx` — sweep `font-display` and ensure pill/circular send pattern reused for primary actions if any
- `apps/webui/src/package-boundaries.test.ts`
- New test files per §Tests
- `docs/design.md` — already created, this spec references it as the source of truth
- `docs/ROADMAP.md` — append M5.7 entry + S0044 row, mark Done after ship
- `apps/webui/README.md` — note the chatbox-style rebuild, drop the Codex/serif description

---

## Risks And Boundaries

- **Sunk cost from S0040–S0042**: M5.5 polish work is now overwritten. The token framework (CSS vars + Tailwind theme.extend) survives; only values flip. Markdown / Shiki / autoscroll logic is untouched. Cost is low.
- **Two flips of `:root` in one week**: state to the team in PR description and ROADMAP. Future visual changes go through `docs/design.md` first.
- **Pure white + 1px borders**: WCAG AA contrast for `--color-text-faint #9CA3AF` on `--color-bg #FFFFFF` is borderline. Reserved strictly for placeholder / disabled where AA does not apply; do **not** use it for primary text. Reviewer must walk every screen.
- **Auto-resize textarea**: can fight with form submit on Enter if the height calc runs after submit. Test: type a multi-line prompt, press Enter; expect submit + clear + height back to one line.
- **Collapse persistence**: storage key shared across all devices in one browser. With many devices the JSON grows; capped naturally by user behavior. No GC strategy this spec.
- **Boundary regex**: the `font-display` className ban must allow comments or strings inside test files; scope the regex to non-test source.
- **Removing topbar**: the `disconnected` badge currently shown on topbar disappears. Connection state is still visible per-device in the sidebar tree (`DeviceStatus` dot). No regression.
- **Single-PR scope**: S0044 touches ~20 files. Keep one commit `S0044: feat: rebuild webui to chatbox style` per repo convention. Avoid mixing unrelated cleanup.
- **Manual e2e is the real gate**: automated tests catch class names; the visual judgment ("is this Chatbox-like?") is human-only. Reviewer must compare against the user-supplied screenshot before merging.
