import { type CSSProperties, type FormEvent, useCallback, useEffect, useId, useRef, useState } from "react";

import { ArrowUp } from "../icons/index.js";
import type { GuiModelProfileView, GuiReasoningEffort } from "../../shared/ipc.js";

export type ComposerProps = {
  value: string;
  onChange(value: string): void;
  onSubmit(): void;
  disabled: boolean;
  inFlight: boolean;
  models?: GuiModelProfileView["models"];
  selectedModelId?: string;
  onModelChange?(modelId: string): void;
  reasoningEffort?: GuiReasoningEffort | "";
  onReasoningEffortChange?(reasoningEffort: GuiReasoningEffort | ""): void;
  modelPickerDisabled?: boolean;
  onCancel?(): void;
  contextUsage?: ComposerContextUsage;
};

const MAX_HEIGHT = 200;
const PERCENT_FORMAT = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const TOKEN_FORMAT = new Intl.NumberFormat("en-US");

export type ComposerContextUsage = {
  usedTokens?: number;
  totalTokens: number;
  autoCompactThreshold: number;
};

export function Composer({
  value,
  onChange,
  onSubmit,
  disabled,
  inFlight,
  models = [],
  selectedModelId = "",
  onModelChange,
  reasoningEffort = "",
  onReasoningEffortChange,
  modelPickerDisabled,
  onCancel,
  contextUsage,
}: ComposerProps) {
  void onCancel;
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const composingRef = useRef(false);
  const empty = value.trim().length === 0;
  const canSubmit = !disabled && !empty && !inFlight;
  const reasoningSupported = models.find((model) => model.modelId === selectedModelId)?.reasoning === true;

  const handleSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>): void => {
      event.preventDefault();
      if (composingRef.current) return;
      if (canSubmit) onSubmit();
    },
    [canSubmit, onSubmit],
  );

  useEffect(() => {
    const node = textareaRef.current;
    if (!node) return;
    node.style.height = "auto";
    const next = Math.min(node.scrollHeight, MAX_HEIGHT);
    node.style.height = `${next}px`;
  }, [value]);

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
        onCompositionStart={() => {
          composingRef.current = true;
        }}
        onCompositionEnd={() => {
          composingRef.current = false;
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            if (composingRef.current || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) {
              return;
            }
            event.preventDefault();
            if (canSubmit) onSubmit();
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
          <select
            className="composer__model-select composer__reasoning-select"
            value={reasoningEffort}
            disabled={disabled || modelPickerDisabled || !reasoningSupported}
            onChange={(event) => onReasoningEffortChange?.(event.currentTarget.value as GuiReasoningEffort | "")}
            aria-label="Reasoning Effort"
            data-testid="composer-reasoning-effort-picker"
            title={reasoningSupported ? "Reasoning Effort" : "Selected model does not support reasoning effort"}
          >
            <option value="">Default effort</option>
            <option value="minimal">Minimal</option>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="xhigh">Extra high</option>
          </select>
          {contextUsage ? <ContextIndicator usage={contextUsage} /> : null}
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

function ContextIndicator({ usage }: { usage: ComposerContextUsage }) {
  const [tooltipVisible, setTooltipVisible] = useState(false);
  const tooltipId = useId();
  const radius = 7;
  const circumference = 2 * Math.PI * radius;
  const totalTokens = Math.max(1, Math.floor(usage.totalTokens));
  const reportedUsedTokens = usage.usedTokens;
  const usageAvailable = typeof reportedUsedTokens === "number" && Number.isFinite(reportedUsedTokens);
  const usedTokens = usageAvailable ? Math.max(0, Math.floor(reportedUsedTokens)) : 0;
  const threshold = clampRatio(usage.autoCompactThreshold);
  const usedRatio = Math.min(1, usedTokens / totalTokens);
  const remainingRatio = Math.max(0, 1 - usedRatio);
  const usedPercentValue = Math.round(usedRatio * 100);
  const thresholdPercentValue = Math.round(threshold * 100);
  const compactZone = Math.max(0.01, 1 - threshold);
  let state = "normal";
  if (!usageAvailable) {
    state = "unavailable";
  } else if (usedRatio >= threshold) {
    state = "danger";
  } else if (usedRatio >= Math.min(0.75, threshold * 0.9)) {
    state = "warn";
  }
  const usedPercent = formatPercent(usedRatio);
  const remainingPercent = formatPercent(remainingRatio);
  const thresholdPercent = formatPercent(threshold);
  const style = {
    "--context-zone-offset": String(-circumference * threshold),
    "--context-zone-length": String(circumference * compactZone),
    "--context-zone-gap": String(circumference * (1 - compactZone)),
  } as CSSProperties;

  return (
    <div
      className={`composer-context composer-context--${state}`}
      tabIndex={0}
      aria-label={usageAvailable
        ? `Context used ${usedPercent}, ${remainingPercent} remaining, ${TOKEN_FORMAT.format(usedTokens)} of ${TOKEN_FORMAT.format(totalTokens)} tokens`
        : "Context usage unavailable"}
      aria-describedby={tooltipVisible ? tooltipId : undefined}
      data-testid="composer-context-indicator"
      data-used-percent={usageAvailable ? String(usedPercentValue) : undefined}
      data-threshold-percent={String(thresholdPercentValue)}
      style={style}
      onMouseEnter={() => setTooltipVisible(true)}
      onMouseLeave={() => setTooltipVisible(false)}
      onFocus={() => setTooltipVisible(true)}
      onBlur={() => setTooltipVisible(false)}
    >
      <svg className="composer-context__ring" viewBox="0 0 18 18" aria-hidden="true">
        <circle className="composer-context__track" cx="9" cy="9" r={radius} />
        <circle className="composer-context__zone" cx="9" cy="9" r={radius} />
        <circle
          className="composer-context__progress"
          cx="9"
          cy="9"
          r={radius}
          strokeDasharray={`${circumference * usedRatio} ${circumference * (1 - usedRatio)}`}
        />
      </svg>
      {tooltipVisible ? (
        <div id={tooltipId} className="composer-context__tooltip" role="tooltip">
          <div className="composer-context__tooltip-title">上下文窗口：</div>
          {usageAvailable ? (
            <>
              <div>{usedPercent} 已用（剩余 {remainingPercent}）</div>
              <div>
                已用 {TOKEN_FORMAT.format(usedTokens)} Token，共 {TOKEN_FORMAT.format(totalTokens)} Token
              </div>
            </>
          ) : (
            <>
              <div>暂无 Provider 上下文用量</div>
              <div>上下文窗口共 {TOKEN_FORMAT.format(totalTokens)} Token</div>
            </>
          )}
          <div className="composer-context__tooltip-threshold">达到 {thresholdPercent} 时自动压缩</div>
        </div>
      ) : null}
    </div>
  );
}

const clampRatio = (value: number): number => {
  if (!Number.isFinite(value)) return 0.8;
  return Math.min(0.99, Math.max(0.01, value));
};

const formatPercent = (ratio: number): string => `${PERCENT_FORMAT.format(Math.max(0, Math.min(1, ratio)) * 100)}%`;
