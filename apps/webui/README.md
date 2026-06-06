# @scorel/app-webui

Browser UI for inspecting and controlling a remote Scorel daemon. Built on Next.js 14 (App Router) and Tailwind 4. Pairs 1:1 with the same `WsTransport` the CLI uses, so a WebUI tab and a `scorel attach` terminal share the same session and event stream.

This README is the developer-facing onboarding doc for M5. It covers install / dev / build, how to point the UI at a real daemon, and the current v1 limitations.

---

## Install

From the monorepo root:

```bash
pnpm install
```

Workspace deps resolve via `workspace:*`; nothing here ships independently.

## Dev

```bash
pnpm --filter @scorel/app-webui dev
```

Default URL: `http://localhost:3000`. The dev server is a vanilla Next.js dev server — no special harness.

## Build

```bash
pnpm --filter @scorel/app-webui build
```

`next build` runs the same TypeScript and ESM boundaries the test pipeline asserts. CI still calls the workspace-wide `pnpm typecheck && pnpm test` before shipping.

## Test

```bash
pnpm --filter @scorel/app-webui test
```

Vitest + jsdom. Boundary tests forbid `node:*`, `fs`, `@scorel/core`, and `@scorel/daemon` imports anywhere under `app/`, `components/`, `lib/`, or `src/` (test files excepted, by design).

---

## Pointing the WebUI at a real daemon

The WebUI never spawns a daemon; you start one separately and add it as a Device.

### Auto-detect (preferred, S0043)

When the WebUI runs on the same host as the daemon, the Settings page detects `~/.scorel/daemon.json` automatically:

1. `pnpm dev` from the repo root brings up both `scorel host serve --no-relay` and `scorel webui` (`scorel up`).
2. Open `http://127.0.0.1:3000/settings`.
3. A **Detected local daemon** banner appears above the device list with the daemon's `wsUrl`. Click **Use this device** to add it to the BrowserStore and route to its device page.

The detection request hits `GET /api/local-daemon`, a Next App Router server route. Important invariants:

- The route reads `~/.scorel/daemon.json` server-side; the file contents never appear in the client JS bundle.
- It only succeeds when the WebUI server runs on the same machine as the daemon. Hosting the WebUI on a remote machine returns `404 { ok: false }` because the file does not exist there. Acceptable v1.
- The token returned is the same persistent token CLI / `scorel attach` use; treat the same-origin browser tab as already-trusted with local filesystem access.

### Manual (direct WS)

For a Host reachable through a direct WebSocket endpoint, add the device by hand:

### 1. Start a Host

In the repo (or anywhere with a Scorel install), pick a working directory and start a Host:

```bash
scorel host serve \
  --token TOKEN \
  --port 18789 \
  --project /path/to/repo \
  --no-relay
```

Required:

- `--token TOKEN` — shared secret. The WebUI sends it back during the WebSocket handshake.
- `--port` — defaults to `7777`; pin one for the WebUI.
- `--project` — an initial project directory registered during Host startup. New Chat resolves its project through the Host registry.
- `--no-relay` — keeps this as a direct local/dev Host instead of connecting to the hosted Relay.

The Host prints its connection link on startup, e.g. `ws://127.0.0.1:18789`.

### 2. Add the Device in the WebUI

1. Open the WebUI (`pnpm --filter @scorel/app-webui dev` → http://localhost:3000).
2. Go to Settings.
3. **Add Device** with:
   - `Name` — anything, used for sidebar display only.
   - `Link` — the daemon's `ws://` or `wss://` URL.
   - `Token` — same string passed to `--token`.
4. Sidebar dot turns green once the WebSocket handshake completes; the project tree populates from `list_projects` and reflects the complete Host Project Registry for that Device.

Configured Devices auto-connect when the WebUI mounts, so a page refresh re-establishes daemon connectivity and repopulates sidebar state instead of leaving the device idle until a deeper route is opened.

### 3. Add Projects from the sidebar (S0049)

Once a Device is connected, the sidebar's **添加项目** action browses the target Device Host filesystem and registers a working directory through daemon APIs:

1. Click **添加项目** in the sidebar.
2. If there is one Device, the dialog browses it immediately. If there are multiple Devices, pick one first.
3. Navigate using only the Host-returned directory entries and `parentPath`.
4. Click **选择当前目录** to call `registerProject(workDir)`.

Important behavior:

- Browsing happens on the target Device Host, not in the browser's local filesystem.
- Registration is idempotent for the same canonical directory; repeated registration reuses the same `projectId`.
- After registration, the WebUI re-runs `list_projects` and refreshes from Host truth instead of locally appending a guessed project row.
- Ordinary WebUI does not expose `remove_project`.

### 4. Start chatting

1. Click into a project in the sidebar.
2. Click **+ New Chat**. The WebUI calls `create_session({ projectId })` on the daemon, navigates to `/devices/:id/projects/:projectId/sessions/:sessionId`, and opens an empty chatbox.
3. Send a prompt. Streaming text + tool calls render live. The session JSONL is written under `~/.scorel/sessions/...` on the daemon host.
4. Optional: open `scorel attach --remote ws://… --session <id>` in another terminal to watch the same session from the CLI.

---

## Known limitations (v1)

These are intentional cuts in M5. They are tracked in `docs/ROADMAP.md` for future milestones.

- **Token stored cleartext in `localStorage`.** No encryption, no OS keychain integration. Use a throwaway token for shared/public devices and rotate it via daemon restart when needed.
- **Manual reconnect on persistent error.** The connection pool retries with exponential backoff up to 5 attempts (1s/2s/4s/8s/30s). After that, the sidebar shows the device as offline and the user has to click Reconnect.
- **No Skills / Plugins / Automations.** v1 is read/control only; the daemon's extension surface is not exposed in the UI.
- **No `cwd` input on New Chat.** New sessions resolve the selected registered project's canonical working directory.
- **No model picker on New Chat.** Sessions take whatever default model the daemon's config selects. WebUI does not let the user override per-session.
- **No project search, session search, branch / fork / compact UI.** Out of scope for v1.

---

## Design tokens and fonts (S0040 → S0044)

The WebUI uses a Chatbox-style three-segment shell with ChatGPT-philosophy
visuals (S0044). M5.5's warm-paper + ink-blue + Newsreader serif palette
(S0040–S0042) was retired in favour of pure white + near-black + sans-only:

- **Single light theme** — `#FFFFFF` page bg, `#F7F7F8` sidebar surface, `#0D0D0D` text + accent (single black for active session and the circular send button), no shadows. Dark mode is intentionally backlog.
- **CSS variables in `app/globals.css` `:root`** — every color, font family, font size + line-height pair, spacing step, and border radius lives behind a `--color-*` / `--font-*` / `--text-*` / `--space-*` / `--radius-*` variable. Box-shadow tokens still exist but resolve to `none` so the "no shadow anywhere" rule holds while existing utilities keep compiling.
- **Tailwind `theme.extend` in `tailwind.config.ts`** — maps each variable to a semantic utility (`bg-surface`, `bg-surface-hover`, `text-muted`, `border-subtle`, `text-accent`, `text-status-ok|warn|err|idle`, `text-md`, `space-y-3`, `rounded-pill`, `rounded-full`, …). Components consume these utilities only; literal `zinc-*` / `emerald-*` / `red-*` / `amber-*` / `neutral-*` are banned and enforced by `src/package-boundaries.test.ts`.
- **Self-hosted mono font** — `@fontsource/jetbrains-mono` is bundled as woff2 and imported once at the top of `app/layout.tsx`, so first paint never waits on a Google Fonts network request. Body sans uses the platform `system-ui` stack and never loads a font. The Newsreader display serif was removed in S0044 — there is no serif anywhere.
- **Focus ring globals** — `*:focus-visible` in `globals.css` paints `outline: 2px solid var(--color-text)` with a 2px offset; box-shadow rings are not used.
- **Codex-semantic placeholders** — unimplemented buttons (sidebar Search/Plugins/Automation, theme toggle, composer attach/voice/model picker) render with the native `disabled` attribute plus the `.btn-disabled` class (`opacity 0.4 + cursor-not-allowed + pointer-events: none`), no tooltip. Visible-but-inert is the product honesty signal.

Sidebar layout: top fixed actions (`+ 新对话` active + 3 grayed) → middle device/project tree with per-row ▸/▾ collapse persisted to `localStorage["scorel.ui.collapsed"]` → bottom fixed `Settings` link + grayed theme toggle. The main area has no topbar; populated chat shows transcript only, empty home shows a centered greeting.

The sidebar's **添加项目** dialog lives in the same shell layer and reuses the existing connection pool. Successful registration auto-expands the target Device / Project nodes and routes to `/devices/:deviceId/projects/:projectId`.

On the empty home state, the greeting line's inline project label is the same project picker as the footer row: changing either one updates the shared route-backed selection.

Composer: a 24px pill with `Message Scorel…` placeholder, three grayed placeholders on the action row (`⊕`, `model ▾`, `🎤`), and a circular black send button (`↑`) that swaps to a red cancel (`■`) while a turn is in flight. The textarea auto-resizes up to ~5 lines.

When dark mode lands later it will swap variable values inside a `prefers-color-scheme: dark` block; component classes do not change.

## Markdown rendering (S0041)

Chatbox markdown lives in one place: `components/chatbox/markdown-view.tsx`. Every user, assistant, thinking, and tool block flows through this component, so visual changes (heading style, link color, code-block chrome) are a single-file edit.

Stack:

- **`react-markdown` 10** — markdown → React element tree. We never use `dangerouslySetInnerHTML` for markdown; the renderer produces real React elements so custom components (links, code blocks, tables) can be injected without portal hacks.
- **`remark-gfm` 4** — GitHub Flavored Markdown: tables, task lists, strikethrough, autolinks.
- **`rehype-sanitize` 6** — schema-based hast sanitizer. Schema lives at module scope in `markdown-view.tsx` and is reviewed alongside the file. The schema starts from `defaultSchema` and only widens `code.className`, `span.className`, and `a[target|rel]`.
- **`shiki` 4 + `@shikijs/rehype` 4** — VS Code-grade code highlighting. Lazy-loaded via `lazy(() => import("./shiki-code-block"))` so the highlighter engine + WASM never enter the first paint of an empty chat. Languages are split into per-grammar chunks via a static loader map (`LANG_LOADERS`); adding a language is a one-line addition.
- **`@tailwindcss/typography` 0.5** — `prose` defaults for headings / lists / tables. The `.prose-tweak` class in `app/globals.css` rewires every typography variable to design tokens so prose colors match the warm-paper / ink-blue palette.

Security boundaries (must hold across edits):

- **`rehype-raw` is intentionally absent.** Adding it would surface raw HTML from LLM output through the sanitizer and re-open the XSS surface. The file carries an inline comment to make the boundary clear; PR review must verify that no plugin re-enables raw HTML.
- **All `<a>` elements get `target="_blank" rel="noreferrer noopener"`** via the custom `a` component, even for user-typed links — keeps the safety floor uniform regardless of source.
- **`<script>` and `<style>` are stripped** from the schema's tag-name list defensively; the default schema already excludes them, but the explicit filter survives partial overrides during future maintenance.
- **`src/package-boundaries.test.ts`** whitelists the five new externals (`react-markdown`, `remark-gfm`, `rehype-sanitize`, `shiki`, `@shikijs/rehype`) plus the `shiki/` import prefix used for theme / engine / grammar submodules.

The unified tool block (`turn-tool.tsx`) renders structured tool payloads through the same pipeline by wrapping `JSON.stringify(payload, null, 2)` in a triple-backtick `json` fence and feeding it to `MarkdownView`. Tool calls collapse by default; tool results expand by default only when `isError === true`.

## Architecture quick reference

| Concern | Lives in |
|---|---|
| Device CRUD + storage | `lib/store/devices.ts`, `lib/store/browser-store.ts` |
| Connection pool, retry, identity | `lib/connection/pool.ts`, `lib/connection/state.ts` |
| Project / session sync | `lib/sync/projects.ts`, `lib/sync/sessions.ts` |
| New Chat helper | `lib/sync/session-create.ts` |
| Per-session attach + projector | `lib/connection/session.ts`, `lib/events/projector.ts` |
| Sidebar, project node, chatbox | `components/shell/*`, `components/chatbox/*` |
| Pages (App Router) | `app/devices/[deviceId]/...` |

The WebUI never imports `@scorel/core` or `@scorel/daemon` — it only talks to the daemon via `@scorel/client`'s WebSocket transport.
