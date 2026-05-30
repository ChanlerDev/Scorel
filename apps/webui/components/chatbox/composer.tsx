"use client";

import { useState } from "react";

export type ComposerProps = {
  onSend(content: string): void | Promise<void>;
  disabled?: boolean;
  placeholder?: string;
};

export function Composer({ onSend, disabled, placeholder }: ComposerProps): JSX.Element {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const trimmed = value.trim();
  const sendDisabled = disabled || busy || trimmed.length === 0;

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

  function onKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submit();
    }
  }

  return (
    <form
      data-testid="composer"
      className="flex items-end gap-2 border-t border-zinc-200 bg-white px-3 py-2"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <textarea
        data-testid="composer-input"
        className="min-h-[40px] flex-1 resize-y rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm text-zinc-900 outline-none focus:border-zinc-400"
        placeholder={placeholder ?? "Send a message — Enter to submit, Shift+Enter for newline"}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={onKeyDown}
        disabled={disabled || busy}
        rows={2}
      />
      <button
        type="submit"
        data-testid="composer-send"
        className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm text-white disabled:cursor-not-allowed disabled:bg-zinc-300"
        disabled={sendDisabled}
      >
        Send
      </button>
    </form>
  );
}
