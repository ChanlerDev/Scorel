import { SettingsCard } from "../SettingsCard.js";
import { SettingsHeader } from "../SettingsHeader.js";
import { SettingsRow } from "../SettingsRow.js";
import { Select } from "../controls/Select.js";

export function GeneralSection() {
  return (
    <>
      <SettingsHeader title="常规" subtitle="基础应用偏好设置。" />
      <SettingsCard>
        <SettingsRow
          label="主题"
          description="跟随系统、亮、暗"
          control={
            <Select
              value="system"
              disabled
              options={[
                { value: "system", label: "跟随系统" },
                { value: "light", label: "亮" },
                { value: "dark", label: "暗" },
              ]}
            />
          }
        />
        <SettingsRow
          label="语言"
          description="界面语言"
          control={
            <Select
              value="zh"
              disabled
              options={[
                { value: "zh", label: "中文" },
                { value: "en", label: "English" },
              ]}
            />
          }
        />
      </SettingsCard>
    </>
  );
}
