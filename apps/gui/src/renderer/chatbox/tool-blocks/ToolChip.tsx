import { useState, type ReactNode } from "react";

import { ChevronDown, ChevronRight } from "../../icons/index.js";

export type ToolChipProps = {
  icon: ReactNode;
  title: ReactNode;
  counters?: ReactNode;
  isError?: boolean;
  pending?: boolean;
  defaultOpen?: boolean;
  body?: ReactNode;
};

export function ToolChip({
  icon,
  title,
  counters,
  isError,
  pending,
  defaultOpen,
  body,
}: ToolChipProps) {
  const [open, setOpen] = useState<boolean>(defaultOpen ?? Boolean(isError));
  const toggleable = Boolean(body);
  return (
    <div className={`tool-chip${isError ? " tool-chip--error" : ""}${pending ? " tool-chip--pending" : ""}`}>
      <button
        type="button"
        className="tool-chip__header"
        onClick={() => toggleable && setOpen((v) => !v)}
        aria-expanded={open}
        disabled={!toggleable}
        style={!toggleable ? { cursor: "default" } : undefined}
      >
        <span className="tool-chip__icon">{icon}</span>
        <span className="tool-chip__title">
          {title}
          {pending ? <span className="tool-chip__status"> · pending</span> : null}
        </span>
        <span className="tool-chip__counters">{counters}</span>
        {toggleable ? (
          <span className="tool-chip__chevron">
            {open ? <ChevronDown /> : <ChevronRight />}
          </span>
        ) : (
          <span />
        )}
      </button>
      {toggleable && open ? <div className="tool-chip__body">{body}</div> : null}
    </div>
  );
}
