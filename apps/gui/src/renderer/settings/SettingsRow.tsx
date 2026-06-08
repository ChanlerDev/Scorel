import type { ReactNode } from "react";

export type SettingsRowProps = {
  label: ReactNode;
  description?: ReactNode;
  control?: ReactNode;
};

export function SettingsRow({ label, description, control }: SettingsRowProps) {
  return (
    <div className="settings-row">
      <div className="settings-row__label">
        <span className="settings-row__name">{label}</span>
        {description ? <span className="settings-row__desc">{description}</span> : null}
      </div>
      <div className="settings-row__control">{control}</div>
    </div>
  );
}
