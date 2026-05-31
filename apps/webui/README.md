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

### 1. Start a daemon

In the repo (or anywhere with a Scorel install), pick a working directory and start a remote daemon:

```bash
scorel daemon serve \
  --remote \
  --token TOKEN \
  --port 18789 \
  --cwd /path/to/repo
```

Required:

- `--remote` — exposes the WebSocket endpoint (without it, only the local Unix socket is bound).
- `--token TOKEN` — shared secret. The WebUI sends it back during the WebSocket handshake.
- `--port` — defaults to a non-fixed port; pin one for the WebUI.
- `--cwd` — the daemon's working directory. **All sessions created from this daemon use this `cwd`.** New Chat in the WebUI does not let the user override it. To run a session against a different repo, run a second daemon on a different port.

The daemon prints its connection link on startup, e.g. `ws://127.0.0.1:18789` or `wss://...`.

### 2. Add the Device in the WebUI

1. Open the WebUI (`pnpm --filter @scorel/app-webui dev` → http://localhost:3000).
2. Go to Settings.
3. **Add Device** with:
   - `Name` — anything, used for sidebar display only.
   - `Link` — the daemon's `ws://` or `wss://` URL.
   - `Token` — same string passed to `--token`.
4. Sidebar dot turns green once the WebSocket handshake completes; the project tree populates from `list_projects`.

### 3. Start chatting

1. Click into a project in the sidebar.
2. Click **+ New Chat**. The WebUI calls `create_session({ projectSlug })` on the daemon, navigates to `/devices/:id/projects/:slug/sessions/:sessionId`, and opens an empty chatbox.
3. Send a prompt. Streaming text + tool calls render live. The session JSONL is written under `~/.scorel/sessions/...` on the daemon host.
4. Optional: open `scorel attach --remote ws://… --session <id>` in another terminal to watch the same session from the CLI.

---

## Known limitations (v1)

These are intentional cuts in M5. They are tracked in `docs/ROADMAP.md` for future milestones.

- **Token stored cleartext in `localStorage`.** No encryption, no OS keychain integration. Use a throwaway token for shared/public devices and rotate it via daemon restart when needed.
- **Manual reconnect on persistent error.** The connection pool retries with exponential backoff up to 5 attempts (1s/2s/4s/8s/30s). After that, the sidebar shows the device as offline and the user has to click Reconnect.
- **No Skills / Plugins / Automations.** v1 is read/control only; the daemon's extension surface is not exposed in the UI.
- **No `cwd` input on New Chat.** New sessions inherit the daemon's startup `cwd`. To work in a different working directory, run another daemon.
- **No model picker on New Chat.** Sessions take whatever default model the daemon's config selects. WebUI does not let the user override per-session.
- **No project search, session search, branch / fork / compact UI.** Out of scope for v1.

---

## Design tokens and fonts (S0040)

The WebUI uses a Codex-style visual pass:

- **Single light theme** — warm paper background, ink-blue accent, serif display + system sans body + JetBrains Mono code. Dark mode is intentionally backlog.
- **CSS variables in `app/globals.css` `:root`** — every color, font family, font size + line-height pair, spacing step, border radius, and shadow lives behind a `--color-*` / `--font-*` / `--text-*` / `--space-*` / `--radius-*` / `--shadow-*` variable.
- **Tailwind `theme.extend` in `tailwind.config.ts`** — maps each variable to a semantic utility (`bg-surface`, `text-muted`, `border-subtle`, `text-accent`, `text-status-ok|warn|err|idle`, `font-display`, `text-md`, `space-y-3`, `rounded-md`, `shadow-md`, `shadow-focus`, …). Components consume these utilities only; literal `zinc-*` / `emerald-*` / `red-*` / `amber-*` are banned and enforced by `src/package-boundaries.test.ts`.
- **Self-hosted fonts** — `@fontsource/newsreader` (display serif) and `@fontsource/jetbrains-mono` (mono) are bundled woff2 packages. They are imported once at the top of `app/layout.tsx`, so first paint never waits on a Google Fonts network request. Body sans uses the platform `system-ui` stack and never loads a font.
- **Focus ring globals** — `*:focus-visible` in `globals.css` paints `box-shadow: var(--shadow-focus)`. Components stay utility-only (no `.btn-*` classes) so styling for buttons / links / inputs can evolve without a parallel CSS layer.

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
