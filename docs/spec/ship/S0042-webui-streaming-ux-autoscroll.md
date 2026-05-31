# S0042: WebUI Streaming UX And Autoscroll

## Goal

Polish the streaming chat experience: animated cursor, rAF-batched text-delta integration, IntersectionObserver-driven autoscroll with "Jump to bottom" floating button. Lock the streaming polish without expanding scope to keyboard shortcuts, history, or rewind UI. Builds on S0040 (design tokens) and S0041 (markdown rendering); does not change any rendering content.

Final spec of the M5-polish chain.

## Scope

### Animated streaming cursor

Replace the v1 single faint `▋` character with a CSS-animated caret.

- New file `apps/webui/components/chatbox/streaming-cursor.tsx` (client component) exporting `<StreamingCursor />`.
- Renders a 1ch wide × 1.1em tall element using `bg-text-muted` (semantic token from S0040), `inline-block`, `align-text-bottom`.
- CSS keyframes defined in `apps/webui/app/globals.css`:
  ```css
  @keyframes scorel-caret-blink {
    0%, 50% { opacity: 1; }
    51%, 100% { opacity: 0; }
  }
  .scorel-caret { animation: scorel-caret-blink 1s steps(2) infinite; }
  ```
- Reduced-motion respect: `@media (prefers-reduced-motion: reduce)` overrides the animation to `opacity: 1` (cursor still visible, but static).
- Mounted by `turn-assistant.tsx` as a sibling element when `streaming === true`, **outside** the `MarkdownView` so the parser does not see it.

### rAF-batched text-delta integration

Today the session attach controller emits a state snapshot every event; in pathological streams (100+ tokens/sec) that triggers excessive re-parses through markdown.

- Add `apps/webui/lib/events/delta-batch.ts` (new):
  ```ts
  export type FlushFn = () => void;

  export function createRafBatcher(flush: FlushFn): {
    schedule(): void;
    cancel(): void;
  };
  ```
- Implementation: tracks a pending `requestAnimationFrame` handle; `schedule()` is a no-op if already pending. `cancel()` removes the handle.
- Integrate into `apps/webui/lib/connection/session.ts`:
  - When event is a `text_delta`, project into projector state but **defer the snapshot emission** to the next animation frame via the batcher.
  - Non-delta events (turn_start, turn_end, message_end, persistent message, error) flush synchronously and cancel any pending batch (so the final state is not delayed by a stale rAF).
- Browsers that lack `requestAnimationFrame` (none in supported targets) fall back to `setTimeout(fn, 16)` — implement defensively.
- The batcher must respect document visibility: when the tab is hidden, `requestAnimationFrame` pauses, but `setTimeout` does not. Acceptable v1: deltas accumulate until the tab is visible again. Document.

### Autoscroll + Jump-to-bottom button

- Add `apps/webui/components/chatbox/autoscroll-region.tsx` (client component):
  - Wraps `Transcript` content inside a scrollable `<div>` with overflow-y-auto.
  - Renders an invisible 1px-tall sentinel `<div ref={sentinelRef}>` at the very bottom.
  - Uses `IntersectionObserver` watching the sentinel against the scroll container.
  - State: `isAtBottom: boolean` derived from the latest IntersectionObserver entry.
  - Effect: when new turns are appended (track turn count), if `isAtBottom`, programmatically scroll the sentinel into view; if not, do nothing.
  - Renders `<JumpToBottomButton onClick={...} visible={!isAtBottom && transcriptHasContent} />` — fixed position bottom-right of the scroll region (not viewport), with a 12px margin.
- `JumpToBottomButton` (in same file or sibling): pill-shaped, `bg-surface-raised border border-subtle shadow-md text-muted`, click scrolls sentinel into view smoothly. Show count of unseen new turns since user scrolled away (optional; if implementing, track lastSeenTurnIndex).
- Replace `apps/webui/components/chatbox/transcript.tsx` autoscroll logic with delegation to `<AutoscrollRegion>`. Transcript becomes a pure presenter that takes `turns` and renders them into the region's children.

### Reduced motion + smooth scroll

- Use `scrollIntoView({ behavior: prefers-reduced-motion ? "auto" : "smooth", block: "end" })` for jump.
- Animated cursor and scroll both check `window.matchMedia("(prefers-reduced-motion: reduce)").matches`.

## Not In Scope

- Keyboard shortcuts (Cmd+K, Cmd+B, Cmd+Enter, etc.) — backlog.
- Composer history (`↑` recall) — backlog.
- Sidebar collapse persistence — backlog.
- Tool block specialization — backlog.
- Dark mode — backlog.
- Mid-token markdown segmentation / streamdown swap — only triggered if S0041 flicker turns out unacceptable; not in this spec.
- Search-in-transcript — backlog.

## Acceptance Criteria

- Streaming cursor visibly blinks at 1Hz next to the streaming assistant text. Static under reduced-motion preference.
- During heavy delta load (≥ 50 tokens/sec simulated), markdown re-parses cap at one per animation frame, observable via `console.time` instrumentation in dev. (Not asserted automatically; PR description includes a profile screenshot.)
- Final `assistant_message` arrival flushes any pending rAF batch synchronously; the final transcript matches the streamed transcript without a render gap.
- Scrolling up while streaming pauses autoscroll; new tokens still append but viewport stays put.
- "Jump to bottom" pill appears when user scrolls away from the bottom and disappears when bottom is reached again.
- Smooth scroll engaged unless `prefers-reduced-motion: reduce`.
- No regression in S0041 markdown rendering, S0040 design tokens, or S0038 cancel UX.
- `apps/webui/src/package-boundaries.test.ts` unchanged (no new externals).
- `pnpm --filter @scorel/app-webui typecheck && pnpm --filter @scorel/app-webui test` passes.
- `pnpm --filter @scorel/app-webui build` succeeds.
- Repo-level `pnpm typecheck && pnpm test` passes.
- Manual: stream a long assistant reply; verify cursor blink, smooth append, scroll-up pauses follow, jump button appears, click jumps back.
- M5 polish phase status flipped to **Done** in `docs/ROADMAP.md` (this is the closing spec of the polish chain).

## Tests

- `apps/webui/lib/events/delta-batch.test.ts` (new): schedule coalesces; cancel clears handle; flush executes once per frame; setTimeout fallback path.
- `apps/webui/lib/connection/session.test.ts` (extend):
  - Burst of three `text_delta` events results in one snapshot emission per frame, not three.
  - Subsequent `turn_end` flushes synchronously.
- `apps/webui/components/chatbox/streaming-cursor.test.tsx` (new): renders with class; `prefers-reduced-motion` query disables animation class.
- `apps/webui/components/chatbox/autoscroll-region.test.tsx` (new):
  - Mock IntersectionObserver; assert `isAtBottom` toggles.
  - Adding a new child while `isAtBottom` triggers `scrollIntoView` on sentinel; while not at bottom, no scroll call.
  - JumpToBottomButton visibility binding.
- `apps/webui/components/chatbox/transcript.test.tsx` (extend): delegation works (existing tests should still pass with the wrapper).
- Manual smoke: stream 200-turn fake transcript; profile parse cadence; verify scroll behavior.

## Affected Paths

- `apps/webui/components/chatbox/streaming-cursor.tsx` (new)
- `apps/webui/components/chatbox/streaming-cursor.test.tsx` (new)
- `apps/webui/components/chatbox/autoscroll-region.tsx` (new)
- `apps/webui/components/chatbox/autoscroll-region.test.tsx` (new)
- `apps/webui/components/chatbox/transcript.tsx`
- `apps/webui/components/chatbox/transcript.test.tsx`
- `apps/webui/components/chatbox/turn-assistant.tsx` (mount cursor when streaming)
- `apps/webui/components/chatbox/turn-assistant.test.tsx`
- `apps/webui/lib/events/delta-batch.ts` (new)
- `apps/webui/lib/events/delta-batch.test.ts` (new)
- `apps/webui/lib/connection/session.ts`
- `apps/webui/lib/connection/session.test.ts`
- `apps/webui/app/globals.css` (cursor keyframes + reduced-motion)
- `docs/ROADMAP.md` — flip S0042 row + M5 polish stage to Done

## Risks And Boundaries

- **rAF in hidden tabs**: `requestAnimationFrame` pauses; deltas accumulate until visibility returns. If this causes "snap" on resume, follow-up spec can fall back to `setTimeout` when `document.hidden`. Document.
- **IntersectionObserver in jsdom**: not natively supported. Tests must polyfill or mock. Use `vi.stubGlobal("IntersectionObserver", FakeObserver)` pattern.
- **Smooth scroll + virtual list**: long transcripts may benefit from windowing later; v1 keeps full transcript mounted. Acceptable for typical chat lengths (< 200 turns).
- **Cursor placement**: if cursor renders inside `MarkdownView` it would be parsed as text. Keep it strictly outside the markdown wrapper. Document.
- **Jump button overlap with composer**: position bottom-right of scroll region with margin; the composer sits below the region, not overlapping.
- **Reduced-motion not asserted in tests**: difficult under jsdom; manual check sufficient.
- **Final flush race**: if a `turn_end` arrives in the same tick as a pending rAF, ordering matters. Tests cover the flush-then-cancel path explicitly.
