"use client";

import { useEffect, useRef, useState } from "react";

export type ComposerProps = {
  onSend(content: string): void | Promise<void>;
  disabled?: boolean;
  placeholder?: string;
  /** True between turn_start and turn_end. Toggles Send vs Cancel button. */
  inFlight?: boolean;
  /** True after the user clicked Cancel until the daemon echoes turn_end. */
  cancelling?: boolean;
  /** Callback for the Cancel button + Esc hotkey. */
  onCancel?: () => void;
  /** Optional inline error message rendered below the buttons. */
  errorBanner?: string;
  /** Display-only model label rendered inside the disabled picker button.
   * The picker is a Codex-semantic placeholder; clicking does nothing. */
  modelLabel?: string;
};

// One-line min, ~5-line max. Cap height in pixels rather than `rows` so the
// resize math is consistent regardless of font rendering.
const MAX_HEIGHT_PX = 144;

export function Composer({
  onSend,
  disabled,
  placeholder,
  inFlight = false,
  cancelling = false,
  onCancel,
  errorBanner,
  modelLabel = "Default",
}: ComposerProps): JSX.Element {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const trimmed = value.trim();
  const sendDisabled = disabled || busy || trimmed.length === 0;
  const cancelDisabled = cancelling;

  // Auto-resize: reset to "auto" on every value change so the scrollHeight
  // shrinks back when the user deletes text, then clamp at MAX_HEIGHT_PX.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const next = Math.min(el.scrollHeight, MAX_HEIGHT_PX);
    el.style.height = `${next}px`;
  }, [value]);

  async function submit(): Promise<void> {
    if (sendDisabled) return;
    setBusy(true);
    try {
      await onSend(value);
      setValue("");
      // After clearing, snap back to one line. The effect above handles
      // this on the next render too, but being explicit avoids a frame of
      // stale height during fast Enter→Enter input.
      const el = textareaRef.current;
      if (el) el.style.height = "auto";
    } finally {
      setBusy(false);
    }
  }

  function fireCancel(): void {
    if (!onCancel) return;
    if (!inFlight) return;
    if (cancelling) return;
    onCancel();
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submit();
      return;
    }
    if (event.key === "Escape") {
      // Esc cancels the in-flight turn while focused, mirroring the button.
      // No-op when nothing is in flight or a cancel is already in progress.
      if (inFlight && !cancelling && onCancel) {
        event.preventDefault();
        fireCancel();
      }
    }
  }

  return (
    <form
      data-testid="composer"
      className="bg-bg px-4 pb-6 pt-3"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <div
        data-testid="composer-pill"
        className="mx-auto flex max-w-3xl flex-col rounded-pill border border-subtle bg-bg focus-within:border-text"
      >
        <textarea
          data-testid="composer-input"
          ref={textareaRef}
          className="block w-full resize-none bg-transparent px-5 pb-1 pt-3 text-md text-text outline-none placeholder:text-faint"
          placeholder={placeholder ?? "Message Scorel…"}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={onKeyDown}
          disabled={disabled || busy}
          rows={1}
        />
        <div className="flex items-center justify-between px-3 pb-2">
          <button
            type="button"
            disabled
            data-testid="composer-attach"
            aria-label="Attach"
            className="btn-disabled flex h-7 w-7 items-center justify-center rounded-full text-text"
          >
            <span aria-hidden>⊕</span>
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled
              data-testid="composer-model"
              className="btn-disabled rounded-md px-2 py-1 text-sm text-muted"
            >
              <span>{modelLabel}</span>
              <span aria-hidden> ▾</span>
            </button>
            <button
              type="button"
              disabled
              data-testid="composer-voice"
              aria-label="Voice"
              className="btn-disabled flex h-7 w-7 items-center justify-center rounded-full text-text"
            >
              <span aria-hidden>🎤</span>
            </button>
            {inFlight ? (
              <button
                type="button"
                data-testid="composer-cancel"
                aria-label={cancelling ? "Cancelling" : "Cancel"}
                className="flex h-7 w-7 items-center justify-center rounded-full bg-status-err text-bg disabled:cursor-not-allowed disabled:opacity-60"
                onClick={fireCancel}
                disabled={cancelDisabled}
              >
                <span aria-hidden>{cancelling ? "…" : "■"}</span>
                <span className="sr-only">
                  {cancelling ? "Cancelling" : "Cancel"}
                </span>
              </button>
            ) : (
              <button
                type="submit"
                data-testid="composer-send"
                aria-label="Send"
                className="flex h-7 w-7 items-center justify-center rounded-full bg-accent text-bg hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
                disabled={sendDisabled}
              >
                <span aria-hidden>↑</span>
                <span className="sr-only">Send</span>
              </button>
            )}
          </div>
        </div>
      </div>
      {errorBanner ? (
        <p
          data-testid="composer-error"
          className="mx-auto mt-2 max-w-3xl text-xs text-status-err"
          role="alert"
        >
          {errorBanner}
        </p>
      ) : null}
    </form>
  );
}
