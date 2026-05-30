"use client";

import { useState } from "react";

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
};

export function Composer({
  onSend,
  disabled,
  placeholder,
  inFlight = false,
  cancelling = false,
  onCancel,
  errorBanner,
}: ComposerProps): JSX.Element {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const trimmed = value.trim();
  const sendDisabled = disabled || busy || trimmed.length === 0;
  const cancelDisabled = cancelling;

  async function submit(): Promise<void> {
    if (sendDisabled) return;
    setBusy(true);
    try {
      await onSend(value);
      setValue("");
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
      className="flex flex-col gap-1 border-t border-zinc-200 bg-white px-3 py-2"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <div className="flex items-end gap-2">
        <textarea
          data-testid="composer-input"
          className="min-h-[40px] flex-1 resize-y rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm text-zinc-900 outline-none focus:border-zinc-400"
          placeholder={
            placeholder ?? "Send a message — Enter to submit, Shift+Enter for newline, Esc to cancel"
          }
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={onKeyDown}
          disabled={disabled || busy}
          rows={2}
        />
        {inFlight ? (
          <button
            type="button"
            data-testid="composer-cancel"
            className="rounded-md bg-red-600 px-3 py-1.5 text-sm text-white disabled:cursor-not-allowed disabled:bg-red-300"
            onClick={fireCancel}
            disabled={cancelDisabled}
          >
            {cancelling ? "Cancelling…" : "Cancel"}
          </button>
        ) : (
          <button
            type="submit"
            data-testid="composer-send"
            className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm text-white disabled:cursor-not-allowed disabled:bg-zinc-300"
            disabled={sendDisabled}
          >
            Send
          </button>
        )}
      </div>
      {errorBanner ? (
        <p
          data-testid="composer-error"
          className="text-xs text-red-700"
          role="alert"
        >
          {errorBanner}
        </p>
      ) : null}
    </form>
  );
}
