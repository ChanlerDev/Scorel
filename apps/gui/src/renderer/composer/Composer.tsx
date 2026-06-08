import { type FormEvent, useCallback } from "react";

import { AlertTriangle, ArrowUp, Mic, Plus, Square } from "../icons/index.js";

export type ComposerProps = {
  value: string;
  onChange(value: string): void;
  onSubmit(): void;
  disabled: boolean;
  inFlight: boolean;
  onCancel?(): void;
};

export function Composer({ value, onChange, onSubmit, disabled, inFlight, onCancel }: ComposerProps) {
  const handleSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>): void => {
      event.preventDefault();
      onSubmit();
    },
    [onSubmit],
  );

  const empty = value.trim().length === 0;

  return (
    <form className="composer" onSubmit={handleSubmit} data-testid="composer">
      <textarea
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
            <Plus size={18} />
          </button>
          <button type="button" className="composer__pill composer__pill--warn" disabled>
            <AlertTriangle size={14} />
            完全访问
          </button>
        </div>
        <div />
        <div className="composer__right">
          <button type="button" className="composer__pill" disabled>
            5.5 超高
          </button>
          <button type="button" className="composer__icon-button" disabled aria-label="Voice">
            <Mic size={16} />
          </button>
          {inFlight ? (
            <button
              type="button"
              className="composer__send"
              onClick={onCancel}
              aria-label="Cancel"
              style={{ background: "var(--color-status-err)" }}
            >
              <Square size={14} />
            </button>
          ) : (
            <button
              type="submit"
              className="composer__send"
              disabled={disabled || empty}
              aria-label="Send"
            >
              <ArrowUp size={16} />
            </button>
          )}
        </div>
      </div>
    </form>
  );
}
