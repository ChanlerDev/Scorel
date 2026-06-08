import { type FormEvent, useCallback, useEffect, useRef } from "react";

import { AlertTriangle, ArrowUp, Mic, Plus, Square } from "../icons/index.js";

export type ComposerProps = {
  value: string;
  onChange(value: string): void;
  onSubmit(): void;
  disabled: boolean;
  inFlight: boolean;
  onCancel?(): void;
};

const MAX_HEIGHT = 200;

export function Composer({ value, onChange, onSubmit, disabled, inFlight, onCancel }: ComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const handleSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>): void => {
      event.preventDefault();
      onSubmit();
    },
    [onSubmit],
  );

  useEffect(() => {
    const node = textareaRef.current;
    if (!node) return;
    node.style.height = "auto";
    const next = Math.min(node.scrollHeight, MAX_HEIGHT);
    node.style.height = `${next}px`;
  }, [value]);

  const empty = value.trim().length === 0;

  return (
    <form className="composer" onSubmit={handleSubmit} data-testid="composer">
      <textarea
        ref={textareaRef}
        rows={1}
        className="composer__textarea"
        placeholder="随心输入"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            if (!disabled && !empty) onSubmit();
          }
        }}
      />
      <div className="composer__bar">
        <div className="composer__left">
          <button type="button" className="composer__icon-button" disabled aria-label="Add attachment">
            <Plus size={16} />
          </button>
          <button type="button" className="composer__chip composer__chip--warn" disabled>
            <AlertTriangle />
            完全访问
          </button>
        </div>
        <div className="composer__right">
          <button type="button" className="composer__chip" disabled>
            5.5 中
          </button>
          <button type="button" className="composer__icon-button" disabled aria-label="Voice">
            <Mic size={14} />
          </button>
          {inFlight ? (
            <button
              type="button"
              className="composer__send composer__send--cancel"
              onClick={onCancel}
              aria-label="Cancel"
            >
              <Square size={12} />
            </button>
          ) : (
            <button
              type="submit"
              className="composer__send"
              disabled={disabled || empty}
              aria-label="Send"
            >
              <ArrowUp size={14} />
            </button>
          )}
        </div>
      </div>
    </form>
  );
}
