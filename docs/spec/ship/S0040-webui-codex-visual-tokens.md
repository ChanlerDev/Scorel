# S0040: WebUI Codex-Style Visual Pass + Design Tokens

## Goal

Replace the v1 zinc-grayscale Tailwind utility soup with a Codex App-style visual pass: warm-paper background, ink-blue accent, serif display + sans body + JetBrains Mono code. Introduce CSS-variable-backed design tokens so every component reads semantic classes (`bg-surface`, `text-muted`, `border-subtle`, `text-accent`) instead of literal hex / `zinc-*`. No new functionality — purely a visual + token foundation that S0041 (markdown) and S0042 (streaming UX) build on.

Locked decisions live in `self/discussions/2026-05-31-webui-polish-brainstorm.md` §5.5 and §5.5.1. This spec is the implementation contract.

## Scope

### Design tokens — `apps/webui/app/globals.css`

Define semantic CSS variables on `:root`. **Do not write `dark:` variants in this spec; dark mode is backlog.** Schema:

```css
:root {
  /* color */
  --color-bg: #f6f1e7;            /* warm paper */
  --color-surface: #fbf7ee;       /* card / sidebar surface */
  --color-surface-raised: #ffffff;/* composer, modal */
  --color-border: #e6dfd0;        /* subtle separator */
  --color-border-strong: #c9bfa8;
  --color-text: #1f1b16;          /* primary text */
  --color-text-muted: #5b524a;
  --color-text-faint: #8a8076;
  --color-accent: #1e3a8a;        /* ink-blue primary action */
  --color-accent-hover: #1e40af;
  --color-accent-soft: #dbe3f5;   /* accent background tint */
  --color-status-ok: #2f7d4f;
  --color-status-warn: #b27a18;
  --color-status-err: #b3261e;
  --color-status-idle: #8a8076;

  /* typography */
  --font-display: "Newsreader", ui-serif, Georgia, serif;
  --font-body: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  --font-mono: "JetBrains Mono", ui-monospace, "SF Mono", Menlo, monospace;

  /* sizes */
  --text-xs: 12px;  --leading-xs: 18px;
  --text-sm: 13px;  --leading-sm: 20px;
  --text-base: 14px; --leading-base: 22px;
  --text-md: 16px;  --leading-md: 24px;
  --text-lg: 18px;  --leading-lg: 26px;
  --text-xl: 22px;  --leading-xl: 30px;

  /* spacing — 4px step */
  --space-1: 4px; --space-2: 8px; --space-3: 12px; --space-4: 16px;
  --space-5: 20px; --space-6: 24px; --space-8: 32px;

  /* radius */
  --radius-sm: 4px; --radius-md: 6px; --radius-lg: 10px;

  /* shadow */
  --shadow-sm: 0 1px 2px rgba(31, 27, 22, 0.05);
  --shadow-md: 0 2px 8px rgba(31, 27, 22, 0.08);
  --shadow-focus: 0 0 0 3px rgba(30, 58, 138, 0.25);
}
```

### Tailwind theme.extend — `apps/webui/tailwind.config.ts`

Map every CSS var to a Tailwind utility. After this spec, components write `bg-surface`, `text-muted`, `border-subtle`, `text-accent`, `font-display`, `text-md`, `space-y-3`, `rounded-md`, `shadow-md`, etc. Concretely:

```ts
theme: {
  extend: {
    colors: {
      bg: "var(--color-bg)",
      surface: "var(--color-surface)",
      "surface-raised": "var(--color-surface-raised)",
      border: { DEFAULT: "var(--color-border)", strong: "var(--color-border-strong)" },
      subtle: "var(--color-border)",
      faint: "var(--color-text-faint)",
      muted: "var(--color-text-muted)",
      accent: { DEFAULT: "var(--color-accent)", hover: "var(--color-accent-hover)", soft: "var(--color-accent-soft)" },
      status: {
        ok: "var(--color-status-ok)",
        warn: "var(--color-status-warn)",
        err: "var(--color-status-err)",
        idle: "var(--color-status-idle)",
      },
    },
    textColor: {
      DEFAULT: "var(--color-text)",
      muted: "var(--color-text-muted)",
      faint: "var(--color-text-faint)",
      accent: "var(--color-accent)",
    },
    fontFamily: {
      display: "var(--font-display)",
      sans: "var(--font-body)",
      mono: "var(--font-mono)",
    },
    fontSize: {
      xs: ["var(--text-xs)", "var(--leading-xs)"],
      sm: ["var(--text-sm)", "var(--leading-sm)"],
      base: ["var(--text-base)", "var(--leading-base)"],
      md: ["var(--text-md)", "var(--leading-md)"],
      lg: ["var(--text-lg)", "var(--leading-lg)"],
      xl: ["var(--text-xl)", "var(--leading-xl)"],
    },
    spacing: {
      1: "var(--space-1)", 2: "var(--space-2)", 3: "var(--space-3)",
      4: "var(--space-4)", 5: "var(--space-5)", 6: "var(--space-6)", 8: "var(--space-8)",
    },
    borderRadius: { sm: "var(--radius-sm)", md: "var(--radius-md)", lg: "var(--radius-lg)" },
    boxShadow: {
      sm: "var(--shadow-sm)",
      md: "var(--shadow-md)",
      focus: "var(--shadow-focus)",
    },
  },
},
```

### Fonts — self-host woff2

- Add dev dependency `@fontsource/newsreader` (serif display) and `@fontsource/jetbrains-mono`.
- Body sans uses platform `system-ui` stack (no font load → instant first paint).
- Import the two npm font packages in `apps/webui/app/layout.tsx` once at the top: `import "@fontsource/newsreader/400.css"; import "@fontsource/newsreader/600.css"; import "@fontsource/jetbrains-mono/400.css"; import "@fontsource/jetbrains-mono/500.css";`
- No Google Fonts network calls. Document in README that fonts are bundled.

### Component refactor (utility-class swap)

Replace literal `zinc-*` / `emerald-*` / `red-*` / `amber-*` references with semantic tokens across:

- `apps/webui/app/layout.tsx` — `bg-bg text-text font-sans`; main shell flex layout untouched.
- `apps/webui/components/shell/topbar.tsx` — `bg-surface border-b border-subtle`; title in `font-display text-lg`; "disconnected" badge uses `text-faint`; Settings link uses `text-accent hover:text-accent-hover`.
- `apps/webui/components/shell/sidebar.tsx` — `bg-surface border-r border-subtle`; section headers `font-display text-sm text-muted`; tree rows `text-sm text-text`; active row `bg-accent-soft text-accent` + left border 2px accent.
- `apps/webui/components/shell/device-status.tsx` — dot colors map: idle→`bg-status-idle`, connecting/reconnecting→`bg-status-warn`, connected→`bg-status-ok`, error→`bg-status-err`. Tooltip text uses semantic colors.
- `apps/webui/components/shell/project-node.tsx` / `session-node.tsx` / `new-chat-button.tsx` — same swap.
- `apps/webui/components/settings/device-form.tsx` / `device-list.tsx` — form fields adopt `bg-surface-raised border border-subtle rounded-md`; primary submit `bg-accent text-surface-raised hover:bg-accent-hover`; destructive (Delete) `text-status-err border-status-err`.
- `apps/webui/components/chatbox/composer.tsx` — textarea on `bg-surface-raised border border-subtle rounded-md` with `focus-visible:shadow-focus`; Send button `bg-accent`; Cancel button `bg-status-err` only while in-flight.
- `apps/webui/components/chatbox/transcript.tsx` — `bg-bg`; turn separator uses `border-t border-subtle/50`.
- `apps/webui/components/chatbox/turn-user.tsx` — user bubble `bg-accent-soft border border-subtle rounded-md p-3`; text in `text-text` body sans.
- `apps/webui/components/chatbox/turn-assistant.tsx` — assistant `bg-surface border border-subtle rounded-md p-3`; serif display reserved for any future heading inside content (not used in this spec).
- `apps/webui/components/chatbox/turn-tool.tsx` — `bg-surface-raised border border-subtle rounded-md`; collapse toggle uses `text-accent`; JSON dump in `font-mono text-xs text-muted`.
- `apps/webui/components/chatbox/debug-panel.tsx` — keep fixed bottom-right; `bg-surface-raised text-text border border-subtle shadow-md font-mono text-xs`. Header `font-display text-sm`.

### Focus ring + hover globals

- All interactive elements use `focus-visible:outline-none focus-visible:shadow-focus` (no rings on mouse focus).
- Button hover uses double axis: `hover:bg-*-hover hover:border-strong`.
- Add a `.btn-primary` / `.btn-ghost` / `.btn-danger` class set in `globals.css` for Send / Cancel / Delete reuse, OR keep utility-only — pick utility-only for v1 to avoid CSS-vs-Tailwind dual ownership. Document choice inline.

### Layout density

- Sidebar internal padding `p-3` (12px), section gap `space-y-2`, row height ~28px.
- Chatbox transcript max-width `max-w-3xl mx-auto` to mirror Codex App reading width on wide screens.
- Composer fixed bottom of chatbox column with `p-3` and 1px top border.
- Topbar height ~44px (`h-11`), `px-4`.

### Boundary rule update

- `apps/webui/src/package-boundaries.test.ts`: extend the allowed externals to include the two `@fontsource/*` packages. Justify each in PR description.

## Not In Scope

- Dark mode (backlog).
- Markdown / code highlight rendering inside chatbox (S0041).
- Streaming cursor animation, autoscroll behavior, jump-to-bottom button (S0042).
- Tool block specialization (Bash/Edit/diff viewer; not in this milestone — unified rendering decided in §5.5).
- Cmd+K, keyboard shortcuts, sidebar collapse persistence (backlog).
- Base UI integration scaffolding (introduced as needed in S0041 / later spec; this spec stays utility-only).
- Tailwind plugin `@tailwindcss/typography` — not added until S0041 needs it for markdown prose.
- Animations beyond focus ring transitions.

## Acceptance Criteria

- `apps/webui/app/globals.css` defines every CSS var listed in §Scope under `:root`.
- `apps/webui/tailwind.config.ts` `theme.extend` exposes them as semantic Tailwind classes.
- No literal `zinc-*` / `emerald-*` / `red-*` / `amber-*` colors remain in `apps/webui/{app,components}/**/*.{ts,tsx}`. Verified by an extended boundary test.
- Every interactive element (button, link, input, summary, listitem with click) has `focus-visible:shadow-focus`.
- `@fontsource/newsreader` and `@fontsource/jetbrains-mono` imported once in `app/layout.tsx`. Build emits font woff2 to static output. No Google Fonts request observed at runtime.
- Topbar, Sidebar, Chatbox, Settings page, Composer all visibly use warm-paper background, serif display for headings, ink-blue accent for primary actions.
- `apps/webui/src/package-boundaries.test.ts` extended:
  1. Allowed externals: include `@fontsource/newsreader` and `@fontsource/jetbrains-mono`.
  2. New rule: scan non-test `.ts`/`.tsx` under `app/`, `components/` and fail if any literal `(zinc|emerald|red|amber|sky|stone|slate|gray)-\d{2,3}` appears (regex match in className strings). The test allows the matched class only inside test files (already excluded).
- `pnpm --filter @scorel/app-webui typecheck && pnpm --filter @scorel/app-webui test` passes.
- `pnpm --filter @scorel/app-webui build` succeeds; bundle size delta from font packages documented in PR description.
- Repo-level `pnpm typecheck && pnpm test` passes.
- Manual visual check (browser, after `pnpm --filter @scorel/app-webui dev`): seven routes render with the new visual; engineer takes a screenshot of the chatbox route and pastes it into PR description.

## Tests

- Extend `apps/webui/src/package-boundaries.test.ts` with:
  - `it("forbids literal palette utilities outside design tokens")` — regex over allowed source files.
  - `it("allows @fontsource/* packages in externals whitelist")` — import scanner already covers this; add explicit assertion.
- Update one existing component test (`device-status.test.tsx` is the cleanest) to assert the dot now uses `bg-status-ok` etc., not `bg-emerald-500`.
- All other component tests should keep passing without modification (semantic classes are interchangeable with literal palette as far as Testing Library assertions on visible text go). If any test asserts a literal palette className, update it to the new token name.
- Manual: run `pnpm --filter @scorel/app-webui dev`; click through Settings → Add Device → /devices/:id → Project → Session → New Chat. Confirm the warm paper + ink-blue + serif headings impression on each screen.

## Affected Paths

- `apps/webui/app/globals.css`
- `apps/webui/app/layout.tsx`
- `apps/webui/tailwind.config.ts`
- `apps/webui/package.json` (+ `pnpm-lock.yaml`) — add `@fontsource/newsreader`, `@fontsource/jetbrains-mono`
- `apps/webui/components/shell/topbar.tsx`
- `apps/webui/components/shell/sidebar.tsx`
- `apps/webui/components/shell/device-status.tsx`
- `apps/webui/components/shell/device-status.test.tsx`
- `apps/webui/components/shell/project-node.tsx`
- `apps/webui/components/shell/session-node.tsx`
- `apps/webui/components/shell/new-chat-button.tsx`
- `apps/webui/components/settings/device-form.tsx`
- `apps/webui/components/settings/device-list.tsx`
- `apps/webui/components/chatbox/composer.tsx`
- `apps/webui/components/chatbox/transcript.tsx`
- `apps/webui/components/chatbox/turn-user.tsx`
- `apps/webui/components/chatbox/turn-assistant.tsx`
- `apps/webui/components/chatbox/turn-tool.tsx`
- `apps/webui/components/chatbox/debug-panel.tsx`
- `apps/webui/src/package-boundaries.test.ts`
- `docs/ROADMAP.md` — add M5.10 polish stage entry, flip S0040 row to Done
- `apps/webui/README.md` — note self-hosted fonts and design token approach

## Risks And Boundaries

- **Color contrast**: warm paper + ink-blue passes WCAG AA on body text but the muted variant (`#5b524a` on `#f6f1e7`) sits near the threshold. If a reviewer eyeballs it as too low, raise `--color-text-muted` luminance one notch — do not ship below AA.
- **Font load FOUT**: woff2 self-hosted is fast but still flashes once. Acceptable v1; document.
- **Token churn**: changing one CSS var shifts the whole UI. That is the point. PR review must walk every screen.
- **Tailwind 4 + var-only colors**: Tailwind 4's color resolver supports `var()` natively; no `rgb(var(--x) / <alpha-value>)` trick needed. Verify in `next build`.
- **Boundary test regex**: the literal-palette ban must allow `prose-zinc` (Tailwind typography plugin variant) once S0041 adds it; regex should match standalone `\b(zinc|...)-\d` only, not as a suffix or prefix component. Implement carefully.
- **No dark mode**: every CSS var is single-value. When dark mode lands, flip to `prefers-color-scheme: dark` block in `globals.css` reusing the same var names. Components stay unchanged.
- **PR scope**: this spec touches almost every UI file. Keep one commit per `S0040: feat: …` per repo convention; final commit message: `S0040: feat: apply codex-style visual pass with design tokens`.
