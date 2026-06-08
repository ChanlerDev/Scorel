import type { ReactNode } from "react";

import { SettingsHeader } from "../SettingsHeader.js";

export type SectionPlaceholderProps = {
  title: string;
  subtitle?: ReactNode;
};

export function SectionPlaceholder({ title, subtitle }: SectionPlaceholderProps) {
  return (
    <>
      <SettingsHeader title={title} subtitle={subtitle ?? "待开发"} />
      <div className="section-placeholder">该模块暂未实装</div>
    </>
  );
}
