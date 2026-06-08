import type { ReactNode } from "react";

export type SettingsHeaderProps = {
  title: string;
  subtitle?: ReactNode;
};

export function SettingsHeader({ title, subtitle }: SettingsHeaderProps) {
  return (
    <header className="settings-header">
      <h1>{title}</h1>
      {subtitle ? <p className="settings-header__sub">{subtitle}</p> : null}
    </header>
  );
}
