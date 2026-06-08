import type { ReactNode } from "react";

export type SettingsCardProps = {
  head?: ReactNode;
  children: ReactNode;
};

export function SettingsCard({ head, children }: SettingsCardProps) {
  return (
    <div className="settings-card">
      {head ? <div className="settings-card__head">{head}</div> : null}
      {children}
    </div>
  );
}
