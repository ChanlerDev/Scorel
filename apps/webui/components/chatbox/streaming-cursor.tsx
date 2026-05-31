"use client";

/**
 * Animated streaming cursor for in-flight assistant turns (S0042).
 *
 * Rendered as a sibling of `<MarkdownView>` in `turn-assistant.tsx` so the
 * markdown parser never sees the cursor element. The keyframes that make the
 * caret blink live in `app/globals.css` and are gated on the `.scorel-caret`
 * class — duplicating that class name here would defeat the purpose, so the
 * single source of truth stays in CSS.
 *
 * The CSS also includes a `prefers-reduced-motion: reduce` clause that drops
 * the animation and pins opacity to 1 (cursor still visible, just static).
 *
 * Layout:
 *   - 1ch wide × 1.1em tall (matches body text rhythm)
 *   - inline-block + align-text-bottom so it sits on the same baseline as the
 *     last token of streaming text without nudging the line height.
 *   - bg-muted resolves to `--color-text-muted` (the same hue as faint body
 *     text) so the caret reads as a soft inline indicator rather than a hard
 *     accent.
 */

export type StreamingCursorProps = {
  /**
   * Optional test id override. Defaults to `streaming-cursor` so the existing
   * turn-assistant tests keep matching.
   */
  testId?: string;
};

export function StreamingCursor({
  testId = "streaming-cursor",
}: StreamingCursorProps = {}): JSX.Element {
  return (
    <span
      data-testid={testId}
      aria-hidden="true"
      className="scorel-caret inline-block w-[1ch] h-[1.1em] align-text-bottom bg-muted"
    />
  );
}

export default StreamingCursor;
