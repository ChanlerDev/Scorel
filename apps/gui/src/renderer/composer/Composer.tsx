import { type FormEvent, useCallback, useEffect, useRef } from "react";

import { ArrowUp } from "../icons/index.js";
import type { GuiModelProfileView } from "../../shared/ipc.js";

export type ComposerProps = {
  value: string;
  onChange(value: string): void;
  onSubmit(): void;
  disabled: boolean;
  inFlight: boolean;
  models?: GuiModelProfileView["models"];
  selectedModelId?: string;
  onModelChange?(modelId: string): void;
  modelPickerDisabled?: boolean;
  onCancel?(): void;
};

const MAX_HEIGHT = 200;

export function Composer({
  value,
  onChange,
  onSubmit,
  disabled,
  inFlight,
  models = [],
  selectedModelId = "",
  onModelChange,
  modelPickerDisabled,
  onCancel,
}: ComposerProps) {
  void onCancel;
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
        <div className="composer__right">
          <select
            className="composer__model-select"
            value={selectedModelId}
            disabled={disabled || modelPickerDisabled || models.length === 0}
            onChange={(event) => onModelChange?.(event.currentTarget.value)}
            aria-label="Model"
            data-testid="composer-model-picker"
          >
            {models.length === 0 ? (
              <option value="">Default</option>
            ) : (
              models.map((model) => (
                <option key={model.modelId} value={model.modelId}>
                  {model.displayName}
                </option>
              ))
            )}
          </select>
          <button
            type="submit"
            className="composer__send"
            disabled={disabled || empty || inFlight}
            aria-label="Send"
          >
            <ArrowUp size={14} />
          </button>
        </div>
      </div>
    </form>
  );
}
