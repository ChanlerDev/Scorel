# S0041: WebUI Markdown Rendering, Code Highlight, Unified Tool Block

## Goal

Replace the v1 plain `<pre>` text in `turn-user.tsx` / `turn-assistant.tsx` with a real markdown renderer (GFM + sanitize), add lazy-loaded Shiki code highlighting, render thinking blocks (default folded), and route the existing tool result JSON dump through the same markdown pipeline so every turn type shares one rendering path. Locks the stack chosen in `self/discussions/2026-05-31-webui-polish-brainstorm.md` §8.2.2.

Builds on S0040 design tokens (semantic colors, fonts, focus ring).

## Stack

- `react-markdown@^10.1.0` — React-tree renderer, no `dangerouslySetInnerHTML`.
- `remark-gfm@^4.0.1` — tables, task lists, strikethrough, autolink.
- `rehype-sanitize@^6.0.0` — schema-based hast sanitization (XSS guard).
- `shiki@^4.1.0` + `@shikijs/rehype@^4.1.0` — VS Code-grade syntax highlighting, lazy split out of the main bundle.
- `@tailwindcss/typography@^0.5.x` (Tailwind 4 compatible) — provides `prose` defaults; tinted to design tokens.

## Scope

### `apps/webui/components/chatbox/markdown-view.tsx` (new)

Single source of truth for any markdown-bearing content. Exports `<MarkdownView text={...} />`.

Behavior:

- `react-markdown` configured with `remarkPlugins=[remarkGfm]`, `rehypePlugins=[[rehypeSanitize, sanitizeSchema]]`.
- **Never enable `rehype-raw`.** Document inline.
- Custom `components`:
  - `code` (inline) → `<code class="rounded bg-surface-raised px-1 text-mono text-xs">`.
  - `code` (block) → lazy `<ShikiCodeBlock>` (see below). Fallback `<pre><code>` shown via `<Suspense>`.
  - `a` → `target="_blank" rel="noreferrer noopener"` forced; tokenized class `text-accent hover:text-accent-hover underline-offset-2 hover:underline`.
  - `table` / `th` / `td` → `border border-subtle text-sm` (typography plugin handles most, this enforces token).
  - `ul[data-task-list] li` (GFM task list) → unstyled bullet, checkbox stays as rendered.
- Wrapper `<div class="prose prose-sm max-w-none">` plus `prose-tweak` overrides (defined in `globals.css`) to swap heading/link/code colors to design tokens.
- Memoize the component on the `text` prop. Same prop reference → no re-parse.

### `apps/webui/components/chatbox/shiki-code-block.tsx` (new, lazy)

Default-export only, imported via `lazy(() => import("./shiki-code-block"))` from `markdown-view.tsx`.

Behavior:

- Uses `createHighlighterCore` from Shiki with **on-demand language imports** so the initial chunk only carries the highlighter engine + theme; languages stream in.
- Single highlighter singleton at module scope.
- Theme: one light theme that matches design tokens — pick `github-light-default` (warm) and override its background via wrapper to `bg-surface-raised`.
- Props: `{ lang: string; code: string }`.
- If `lang` not yet loaded: kick off `loadLanguage(lang)` once, render `<pre>{code}</pre>` until ready, then re-render highlighted.
- "Copy" button at top-right of each code block (icon-only, `text-faint hover:text-text`); uses `navigator.clipboard.writeText`.

### `apps/webui/components/chatbox/turn-user.tsx` (modify)

Replace `<pre class="whitespace-pre-wrap font-sans text-sm">{part.text}</pre>` with `<MarkdownView text={part.text} />`.

User markdown is rendered (matches ChatGPT / Claude norms). User input is local — no untrusted source — but still passes through the same sanitizer for consistency.

### `apps/webui/components/chatbox/turn-assistant.tsx` (modify)

Same swap for the `text` part. Streaming text path also routes through `MarkdownView`. Streaming cursor (▋) handled in S0042; this spec keeps current `▋` rendering as a sibling element next to `MarkdownView`, not interleaved into the markdown stream.

Add a new render branch for **thinking** parts: when `part.kind === "thinking"`, render a default-collapsed `<details>` block:

```tsx
<details class="border border-subtle rounded-md p-2 my-2 bg-surface text-muted">
  <summary class="cursor-pointer select-none font-display text-sm">Thinking…</summary>
  <MarkdownView text={part.text} />
</details>
```

Thinking is folded by default per locked decision. The protocol already carries `ThinkingContentBlock`; the projector currently treats it as text — extend `lib/events/projector.ts` so an assistant content block of type `"thinking"` becomes a `TurnPart` with `kind: "thinking"`. Update the union type accordingly.

### `apps/webui/components/chatbox/turn-tool.tsx` (modify, unify)

Replace the raw JSON dump with a unified-rendering path:

```tsx
const fenced = "```json\n" + JSON.stringify(payload, null, 2) + "\n```";
return <MarkdownView text={fenced} />;
```

The `tool_call` and `tool_result` parts both pass their structured payload (args / result) through this fence. Shiki highlights the JSON automatically. Keeps the "unified rendering" decision (§5.5) intact: no Bash/Edit/diff specialization; just one path.

The collapsible `<details>` outer wrapper stays — collapsed by default for `tool_call`, expanded by default for `tool_result` whose `isError === true`.

### `apps/webui/lib/events/projector.ts` (modify)

Extend `TurnPart` union:

```ts
export type TurnPart =
  | { kind: "text"; text: string }
  | { kind: "thinking"; text: string }                           // new
  | { kind: "tool_call"; toolCallId: string; toolName: string; args: unknown }
  | { kind: "tool_result"; toolCallId: string; toolName: string; result: unknown; isError?: boolean };
```

When projecting an `assistant_message`, walk `message.content`:

- `text` → push `{kind: "text", text}`.
- `thinking` → push `{kind: "thinking", text}`.
- `tool_call` → unchanged.

For streaming, `text_delta` continues to merge into the in-flight `text` part. **Thinking blocks are not streamed today** (no transient delta for thinking); they only appear in the final `assistant_message`. Document.

### `apps/webui/app/globals.css` (modify)

Add `prose-tweak` overrides to align Tailwind typography defaults to design tokens. Example:

```css
.prose-tweak {
  --tw-prose-body: var(--color-text);
  --tw-prose-headings: var(--color-text);
  --tw-prose-links: var(--color-accent);
  --tw-prose-bold: var(--color-text);
  --tw-prose-code: var(--color-text);
  --tw-prose-pre-bg: var(--color-surface-raised);
  --tw-prose-pre-code: var(--color-text);
  --tw-prose-quotes: var(--color-text-muted);
  --tw-prose-th-borders: var(--color-border);
  --tw-prose-td-borders: var(--color-border);
}
```

Wrapper in `markdown-view.tsx`: `<div class="prose prose-sm max-w-none prose-tweak">`.

### `apps/webui/tailwind.config.ts` (modify)

Add `@tailwindcss/typography` to `plugins`. Ensure Tailwind 4 compat — if the plugin is not yet released for v4 at install time, fall back to a manual minimal `prose` ruleset in `globals.css` and document. Implementation note: Tailwind 4 supports v0.5.x typography in compatible mode at the time this spec is written; verify on install.

### `apps/webui/package.json` (modify)

Add dependencies:

```json
"react-markdown": "^10.1.0",
"remark-gfm": "^4.0.1",
"rehype-sanitize": "^6.0.0",
"shiki": "^4.1.0",
"@shikijs/rehype": "^4.1.0",
"@tailwindcss/typography": "^0.5.16"
```

(versions floor; pnpm install will resolve latest patch.)

### `apps/webui/src/package-boundaries.test.ts` (modify)

Extend `ALLOWED_EXTERNALS` with `react-markdown`, `remark-gfm`, `rehype-sanitize`, `shiki`, `@shikijs/rehype`. Add `@tailwindcss/typography` only if it appears in TS imports (it usually only lives in `tailwind.config.ts`, which is on the test scan list). PR description must justify each addition in one line.

## Streaming refresh strategy

Per §8.2.6:

- `MarkdownView` is `memo` on `text` prop.
- Each `text_delta` event triggers a single `setState` in the assistant turn; only that turn's `MarkdownView` re-parses.
- A 16ms `requestAnimationFrame` batch lives in the `transcript.tsx` streaming hook (or wherever `text_delta` already integrates) so high-rate token streams cap at one parse per frame. Existing code may already throttle implicitly via React 18's automatic batching; if not, add `useEffect` + `requestAnimationFrame` flush.
- No mid-token splitting / merge-segment optimization. Accept brief flicker on unclosed `**` or open code fences. If real-world feedback is bad, S0041.1 swaps to `streamdown` (runner-up). Document this fallback in PR.

## Sanitizer schema

Defined inline in `markdown-view.tsx`. Start from `defaultSchema` (`rehype-sanitize`):

```ts
const sanitizeSchema: Schema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    code: [...(defaultSchema.attributes?.code ?? []), ["className"]],
    span: [...(defaultSchema.attributes?.span ?? []), ["className"]],
    a: [...(defaultSchema.attributes?.a ?? []), ["target"], ["rel"]],
  },
  tagNames: (defaultSchema.tagNames ?? []).filter(t => t !== "script" && t !== "style"),
};
```

PR review must walk this schema once.

## Not In Scope

- Dark mode (backlog).
- Streaming cursor animation, autoscroll, jump-to-bottom (S0042).
- Tool block specialization (Bash/Edit/Read/diff viewer/TodoWrite list — not in this milestone).
- Cmd+K / shortcuts / sidebar persistence (backlog).
- Mermaid / KaTeX / Mathjax (none of these enabled in sanitizer schema).
- Image rendering: defaultSchema permits `<img>` with `src` allowlist; we leave it as default but no special UI.
- Search / find-in-transcript.
- streamdown runner-up — only switch if real-world flicker is unacceptable; not part of this spec.

## Acceptance Criteria

- `MarkdownView` renders user, assistant, and tool turns through one component.
- GFM features observable: tables, task lists, strikethrough, autolink, code fences.
- Sanitizer drops `<script>`, `<style>`, `onerror`, `javascript:` href; verified by unit tests.
- Code blocks render via lazy Shiki: first paint shows un-highlighted `<pre>`, then highlighted version once Shiki chunk loads. Bundle analyzer (`next build`) shows Shiki in a separate chunk, not in the main route bundle.
- Thinking blocks render as `<details>` collapsed-by-default with serif `Thinking…` summary.
- Tool turns render JSON via `\`\`\`json` fence, syntactically highlighted.
- Streaming text accumulation works: while `text_delta` events flow, the assistant turn's markdown re-parses each frame; no React error boundary triggers on mid-stream unclosed markdown.
- All link `<a>` elements have `target="_blank" rel="noreferrer noopener"`.
- `apps/webui/src/package-boundaries.test.ts` allows the six new externals; PR description justifies each.
- `pnpm --filter @scorel/app-webui typecheck && pnpm --filter @scorel/app-webui test` passes.
- `pnpm --filter @scorel/app-webui build` succeeds; bundle analyzer output captured in PR description; main route `First Load JS` increase ≤ 35 KB gzip (28 KB target + headroom).
- Repo-level `pnpm typecheck && pnpm test` passes.
- Manual visual smoke: open chatbox; LLM reply containing headings, lists, a code block, an inline link, a table → all render with design-token colors and serif headings.

## Tests

- `apps/webui/components/chatbox/markdown-view.test.tsx` (new):
  - Renders headings, lists, table, link.
  - Strips `<script>` and `<img onerror>`.
  - Forces `rel="noreferrer noopener"` on `<a>`.
  - Code block falls back to `<pre>` before Shiki resolves (mock the lazy import).
  - Memoization: same `text` prop → no re-parse (assert via render counter).
- `apps/webui/components/chatbox/turn-tool.test.tsx` (new):
  - Tool result with structured object → JSON fence path → renders within MarkdownView.
  - Default collapsed for `tool_call`, expanded for error `tool_result`.
- `apps/webui/components/chatbox/turn-assistant.test.tsx` (extend):
  - Thinking part renders as `<details>` collapsed.
  - Streaming text re-renders without unmount when delta extends.
- `apps/webui/lib/events/projector.test.ts` (extend):
  - Assistant message with thinking + text + tool_call content blocks projects to three TurnParts in order.
- Manual: real LLM session with markdown-rich reply; visually compare to design.

## Affected Paths

- `apps/webui/components/chatbox/markdown-view.tsx` (new)
- `apps/webui/components/chatbox/markdown-view.test.tsx` (new)
- `apps/webui/components/chatbox/shiki-code-block.tsx` (new, lazy chunk)
- `apps/webui/components/chatbox/turn-user.tsx`
- `apps/webui/components/chatbox/turn-assistant.tsx`
- `apps/webui/components/chatbox/turn-assistant.test.tsx`
- `apps/webui/components/chatbox/turn-tool.tsx`
- `apps/webui/components/chatbox/turn-tool.test.tsx` (new)
- `apps/webui/lib/events/projector.ts`
- `apps/webui/lib/events/projector.test.ts`
- `apps/webui/app/globals.css` (prose-tweak overrides)
- `apps/webui/tailwind.config.ts` (typography plugin)
- `apps/webui/package.json` (+ `pnpm-lock.yaml`)
- `apps/webui/src/package-boundaries.test.ts`
- `docs/ROADMAP.md` — flip S0041 row to Done
- `apps/webui/README.md` — note markdown stack and security considerations (no rehype-raw, sanitize schema)

## Risks And Boundaries

- **XSS**: hardest risk. PR review must inspect `sanitizeSchema` and confirm `rehype-raw` is absent. CI lint hint: a unit test hard-codes a malicious payload (`<img src=x onerror=alert(1)>`) and asserts it does not appear in DOM.
- **Streaming flicker**: unclosed `**` / fence → state jump on token close. Accept v1; document. Fallback to streamdown if real-world bad.
- **Bundle**: 28 KB target + Shiki lazy. Watch grammar JSON size — only load languages on demand. If a code block requests `lang="rust"`, Shiki fetches `wasm/onig` + `rust.json` (~50 KB gzip per language). Acceptable.
- **Typography plugin compat**: Tailwind 4 + `@tailwindcss/typography` 0.5 may need `important: true` or a class override. If plugin breaks build, fallback path (manual prose CSS in `globals.css`) is in scope but a deviation note in PR is mandatory.
- **Boundary test churn**: five new whitelist entries in one PR. Justify each.
- **Thinking block UX**: defaulting to folded means users may not notice the model's reasoning trail. Acceptable; future spec can flip default per project setting.
- **memo correctness**: `MarkdownView` `memo` on `text` only; if `components` prop is recreated each render, memo breaks. Define `components` as module-scope constant.
- **SSR**: `react-markdown` is ESM-only and works in server components, but `turn-*.tsx` are `"use client"`, so no SSR boundary issue. Lazy Shiki import is client-only — safe.
