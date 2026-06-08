import type { ReactNode } from "react";

export type SidebarActionRowProps = {
  icon: ReactNode;
  label: string;
  active?: boolean;
  disabled?: boolean;
  trailing?: ReactNode;
  onClick?: () => void;
  testId?: string;
};

export function SidebarActionRow({
  icon,
  label,
  active,
  disabled,
  trailing,
  onClick,
  testId,
}: SidebarActionRowProps) {
  return (
    <button
      type="button"
      className={`sidebar__row${active ? " sidebar__row--active" : ""}`}
      onClick={onClick}
      disabled={disabled}
      data-testid={testId}
    >
      <span className="sidebar__icon-slot">{icon}</span>
      <span className="sidebar__label">{label}</span>
      {trailing ?? <span />}
    </button>
  );
}
