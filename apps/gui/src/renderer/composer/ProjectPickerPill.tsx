import type { ReactNode } from "react";

import { ChevronDown, Folder } from "../icons/index.js";

export type ProjectPickerPillProps = {
  label: string;
  onClick(): void;
  disabled?: boolean;
  trailing?: ReactNode;
};

export function ProjectPickerPill({ label, onClick, disabled, trailing }: ProjectPickerPillProps) {
  return (
    <button
      type="button"
      className="project-picker-pill"
      onClick={onClick}
      disabled={disabled}
      data-testid="project-picker-pill"
    >
      <Folder />
      <span>{label}</span>
      <ChevronDown />
      {trailing}
    </button>
  );
}
