import type { MouseEvent, ReactNode } from "react";

import { ChevronDown, Folder } from "../icons/index.js";

export type ProjectPickerPillProps = {
  label: string;
  onClick(anchor: DOMRect): void;
  disabled?: boolean;
  trailing?: ReactNode;
  className?: string;
  testId?: string;
};

export function ProjectPickerPill({
  label,
  onClick,
  disabled,
  trailing,
  className,
  testId = "project-picker-pill",
}: ProjectPickerPillProps) {
  const handleClick = (event: MouseEvent<HTMLButtonElement>): void => {
    onClick(event.currentTarget.getBoundingClientRect());
  };

  return (
    <button
      type="button"
      className={`project-picker-pill${className ? ` ${className}` : ""}`}
      onClick={handleClick}
      disabled={disabled}
      data-testid={testId}
    >
      <Folder />
      <span>{label}</span>
      <ChevronDown />
      {trailing}
    </button>
  );
}
