import type { GuiMemorySettingsView, GuiProjectRef } from "../../../shared/ipc.js";
import { SettingsCard } from "../SettingsCard.js";
import { SettingsHeader } from "../SettingsHeader.js";
import { SettingsRow } from "../SettingsRow.js";
import { Select } from "../controls/Select.js";
import { Toggle } from "../controls/Toggle.js";

export type MemorySectionProps = {
  project: GuiProjectRef | null;
  memory: GuiMemorySettingsView;
  busy: boolean;
  setBusy(value: boolean): void;
  setError(message: string | null): void;
  onMemoryChange(memory: GuiMemorySettingsView): void;
};

export function MemorySection(props: MemorySectionProps) {
  const update = async (patch: Partial<GuiMemorySettingsView>): Promise<void> => {
    if (!props.project) return;
    props.setBusy(true);
    try {
      const next = await window.scorel.upsertMemorySettings(props.project, patch);
      props.onMemoryChange(next);
      props.setError(null);
    } catch (cause) {
      props.setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      props.setBusy(false);
    }
  };

  const disabled = props.busy || !props.project;

  return (
    <>
      <SettingsHeader title="记忆" subtitle="自动恢复项目上下文，并在后台沉淀长期记忆。" />
      <section className="settings-section settings-section--wide">
        <SettingsCard>
          <SettingsRow
            label="启用记忆"
            description="在新会话和恢复会话时注入 root/project memory 与最近 daily。"
            control={<Toggle checked={props.memory.enabled} disabled={disabled} onChange={(enabled) => void update({ enabled })} ariaLabel="启用记忆" />}
          />
          <SettingsRow
            label="自动 daily"
            description="让 agent 在完成有意义工作时调用 AppendDaily，写入项目日记。"
            control={<Toggle checked={props.memory.daily} disabled={disabled || !props.memory.enabled} onChange={(daily) => void update({ daily })} ariaLabel="自动 daily" />}
          />
          <SettingsRow
            label="自动 dream"
            description="项目空闲后使用辅助模型把 daily 证据提炼到 Project MEMORY。"
            control={<Toggle checked={props.memory.autoDream} disabled={disabled || !props.memory.enabled} onChange={(autoDream) => void update({ autoDream })} ariaLabel="自动 dream" />}
          />
          <SettingsRow
            label="Dream 延迟"
            description="最后一次 daily 写入后等待多久再整合长期记忆。"
            control={(
              <Select
                value={String(props.memory.dreamIdleMinutes)}
                disabled={disabled || !props.memory.enabled || !props.memory.autoDream}
                ariaLabel="Dream 延迟"
                options={[
                  { value: "0", label: "立即" },
                  { value: "15", label: "15 分钟" },
                  { value: "60", label: "1 小时" },
                  { value: "360", label: "6 小时" },
                ]}
                onChange={(value) => void update({ dreamIdleMinutes: Number(value) })}
              />
            )}
          />
          <SettingsRow
            label="提升到全局"
            description="只把稳定的跨项目偏好写入 root MEMORY。"
            control={<Toggle checked={props.memory.promoteRoot} disabled={disabled || !props.memory.enabled || !props.memory.autoDream} onChange={(promoteRoot) => void update({ promoteRoot })} ariaLabel="提升到全局" />}
          />
        </SettingsCard>
      </section>
    </>
  );
}
