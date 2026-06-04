"use client";

import { useEffect, useRef, useState } from "react";
import type { RunningMessageBehavior } from "../../lib/store/running-behavior";
import type { QueuePreviewItem } from "../../lib/events/projector";

export type ComposerProps = {
  onSend(content: string, runningBehavior?: RunningMessageBehavior): void | Promise<void>;
  onRewriteQueue?: (queue: RunningMessageBehavior, items: QueuePreviewItem[]) => void | Promise<void>;
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
  runningBehavior?: RunningMessageBehavior;
  queuedItems?: QueuePreviewItem[];
};

// One-line min, ~5-line max. Cap height in pixels rather than `rows` so the
// resize math is consistent regardless of font rendering.
const MAX_HEIGHT_PX = 144;

export function Composer({
  onSend,
  onRewriteQueue,
  disabled,
  placeholder,
  inFlight = false,
  cancelling = false,
  onCancel,
  errorBanner,
  modelLabel = "Default",
  runningBehavior = "follow_up",
  queuedItems = [],
}: ComposerProps): JSX.Element {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const trimmed = value.trim();
  const sendDisabled = disabled || busy || trimmed.length === 0;
  const cancelDisabled = cancelling;
  const visibleQueuedItems = queuedItems;

  // Auto-resize: reset to "auto" on every value change so the scrollHeight
  // shrinks back when the user deletes text, then clamp at MAX_HEIGHT_PX.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const next = Math.min(el.scrollHeight, MAX_HEIGHT_PX);
    el.style.height = `${next}px`;
  }, [value]);

  async function submit(behaviorOverride?: RunningMessageBehavior): Promise<void> {
    if (sendDisabled) return;
    const submitted = value;
    const behavior = inFlight ? behaviorOverride ?? runningBehavior : undefined;
    setValue("");
    const el = textareaRef.current;
    if (el) el.style.height = "auto";
    setBusy(true);
    try {
      await onSend(submitted, behavior);
    } catch (cause) {
      setValue((current) => restoreFailedSubmission(submitted, current));
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

  async function rewriteQueue(queue: RunningMessageBehavior, items: QueuePreviewItem[]): Promise<void> {
    if (!onRewriteQueue) return;
    await onRewriteQueue(queue, items);
  }

  async function deleteQueueItem(item: QueuePreviewItem): Promise<void> {
    const remaining = queuedItems.filter((candidate) => candidate.queue === item.queue && candidate.id !== item.id);
    await rewriteQueue(item.queue, remaining);
  }

  async function convertQueueItem(item: QueuePreviewItem): Promise<void> {
    const nextQueue = oppositeBehavior(item.queue);
    const sourceItems = queuedItems.filter((candidate) => candidate.queue === item.queue && candidate.id !== item.id);
    const targetItems = queuedItems
      .filter((candidate) => candidate.queue === nextQueue)
      .concat({ ...item, queue: nextQueue, updatedAt: Date.now() });
    await rewriteQueue(item.queue, sourceItems);
    await rewriteQueue(nextQueue, targetItems);
  }

  async function editQueueItem(item: QueuePreviewItem): Promise<void> {
    setValue((current) =>
      current.length === 0 ? item.text : `${item.text}\n\n${current}`,
    );
    textareaRef.current?.focus();
    await deleteQueueItem(item);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void submit(event.shiftKey ? oppositeBehavior(runningBehavior) : runningBehavior);
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
        className="mx-auto flex max-w-3xl flex-col rounded-pill border border-subtle bg-bg focus-within:border-border-strong"
      >
        {visibleQueuedItems.length > 0 ? (
          <div
            data-testid="composer-queue-strip"
            className="mx-4 mt-3 flex flex-col gap-1 border-b border-subtle pb-2"
          >
            {[...visibleQueuedItems].reverse().map((item) => (
              <div
                key={`${item.queue}:${item.id}`}
                data-testid={`composer-queue-${item.queue}`}
                className="flex min-h-8 items-center gap-2 rounded-md bg-surface px-3 text-sm text-muted"
              >
                <span className="shrink-0 text-xs text-faint">
                  {item.queue === "follow_up" ? "Follow up" : "Steer"}
                </span>
                <span className="min-w-0 truncate text-text">{item.text}</span>
                <span className="ml-auto flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    data-testid={`composer-queue-toggle-${item.id}`}
                    aria-label={`Convert to ${runningBehaviorLabel(oppositeBehavior(item.queue))}`}
                    onClick={() => void convertQueueItem(item)}
                    className="rounded-sm px-1.5 py-1 text-xs text-muted hover:bg-surface-hover hover:text-text focus-visible:outline-none"
                  >
                    ↪
                  </button>
                  <button
                    type="button"
                    data-testid={`composer-queue-edit-${item.id}`}
                    aria-label="Edit queued input"
                    onClick={() => void editQueueItem(item)}
                    className="rounded-sm px-1.5 py-1 text-xs text-muted hover:bg-surface-hover hover:text-text focus-visible:outline-none"
                  >
                    ✎
                  </button>
                  <button
                    type="button"
                    data-testid={`composer-queue-delete-${item.id}`}
                    aria-label="Delete queued input"
                    onClick={() => void deleteQueueItem(item)}
                    className="rounded-sm px-1.5 py-1 text-xs text-muted hover:bg-surface-hover hover:text-text focus-visible:outline-none"
                  >
                    ×
                  </button>
                </span>
              </div>
            ))}
          </div>
        ) : null}
        <textarea
          data-testid="composer-input"
          ref={textareaRef}
          className="block w-full resize-none bg-transparent px-5 pb-1 pt-3 text-md text-text outline-none placeholder:text-faint focus-visible:outline-none"
          placeholder={placeholder ?? "Message Scorel…"}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={onKeyDown}
          disabled={disabled}
          rows={1}
        />
        <div className="flex items-center justify-between px-3 pb-2">
          <button
            type="button"
            disabled
            data-testid="composer-attach"
            aria-label="Attach"
            className="btn-disabled flex h-7 w-7 items-center justify-center rounded-full text-text focus-visible:outline-none"
          >
            <span aria-hidden>⊕</span>
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled
              data-testid="composer-model"
              className="btn-disabled rounded-md px-2 py-1 text-sm text-muted focus-visible:outline-none"
            >
              <span>{modelLabel}</span>
              <span aria-hidden> ▾</span>
            </button>
            <button
              type="button"
              disabled
              data-testid="composer-voice"
              aria-label="Voice"
              className="btn-disabled flex h-7 w-7 items-center justify-center rounded-full text-text focus-visible:outline-none"
            >
              <span aria-hidden>🎤</span>
            </button>
            {inFlight ? (
              <button
                type="button"
                data-testid="composer-cancel"
                aria-label={cancelling ? "Cancelling" : "Cancel"}
                className="flex h-7 w-7 items-center justify-center rounded-full bg-status-err text-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong disabled:cursor-not-allowed disabled:opacity-60"
                onClick={fireCancel}
                disabled={cancelDisabled}
              >
                <span aria-hidden>{cancelling ? "…" : "■"}</span>
                <span className="sr-only">
                  {cancelling ? "Cancelling" : "Cancel"}
                </span>
              </button>
            ) : null}
            <button
              type="submit"
              data-testid="composer-send"
              aria-label={inFlight ? `Send ${runningBehaviorLabel(runningBehavior)}` : "Send"}
              className="flex h-7 w-7 items-center justify-center rounded-full bg-accent text-bg hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong disabled:cursor-not-allowed disabled:opacity-40"
              disabled={sendDisabled}
            >
              <span aria-hidden>↑</span>
              <span className="sr-only">
                {inFlight ? `Send ${runningBehaviorLabel(runningBehavior)}` : "Send"}
              </span>
            </button>
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

const oppositeBehavior = (value: RunningMessageBehavior): RunningMessageBehavior =>
  value === "follow_up" ? "steer" : "follow_up";

const runningBehaviorLabel = (value: RunningMessageBehavior): string =>
  value === "follow_up" ? "follow up" : "steer";

const restoreFailedSubmission = (submitted: string, current: string): string => {
  if (current.length === 0) return submitted;
  if (current === submitted || current.startsWith(`${submitted}\n`)) return current;
  return `${submitted}\n\n${current}`;
};
