import type { GuiDeviceRef, GuiTaskBudgetSettingsView } from "../../../shared/ipc.js";
import { SettingsCard } from "../SettingsCard.js";
import { SettingsHeader } from "../SettingsHeader.js";
import { SettingsRow } from "../SettingsRow.js";

export type BudgetSectionProps = {
  device: GuiDeviceRef;
  taskBudget: GuiTaskBudgetSettingsView;
  busy: boolean;
  setBusy(value: boolean): void;
  setError(message: string | null): void;
  onTaskBudgetChange(taskBudget: GuiTaskBudgetSettingsView): void;
};

const FIELDS = [
  ["maxTokens", "Token 预算", "超过该总 token 数时提醒；0 表示禁用。"],
  ["maxCostUsd", "成本预算（USD）", "超过该预估成本时提醒；0 表示禁用。"],
  ["maxWallClockMinutes", "最长运行时间（分钟）", "超过该墙钟时间时提醒；0 表示禁用。"],
  ["repeatedCommandThreshold", "重复命令阈值", "连续相同 Bash 命令或连续工具错误达到该次数时提醒；0 表示禁用。"],
  ["staleProgressMinutes", "无进展阈值（分钟）", "超过该时间没有助手输出、工具调用或成功工具结果时提醒；0 表示禁用。"],
] as const;

export function BudgetSection(props: BudgetSectionProps) {
  const update = async (key: keyof GuiTaskBudgetSettingsView, raw: string): Promise<void> => {
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0) {
      props.setError("预算必须是非负数。");
      return;
    }
    props.setBusy(true);
    try {
      const next = await window.scorel.upsertTaskBudgetSettings(props.device, { [key]: value });
      props.onTaskBudgetChange(next);
      props.setError(null);
    } catch (cause) {
      props.setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      props.setBusy(false);
    }
  };

  return (
    <>
      <SettingsHeader title="任务预算" subtitle="超出预算或停滞时，Scorel 只注入状态总结与策略重评估提醒，不会隐式终止任务。" />
      <section className="settings-section settings-section--wide">
        <SettingsCard>
          {FIELDS.map(([key, label, description]) => (
            <SettingsRow
              key={key}
              label={label}
              description={description}
              control={
                <input
                  aria-label={label}
                  className="input-text"
                  disabled={props.busy}
                  min="0"
                  step={key === "maxCostUsd" ? "0.01" : "1"}
                  type="number"
                  value={props.taskBudget[key]}
                  onBlur={(event) => void update(key, event.currentTarget.value)}
                />
              }
            />
          ))}
        </SettingsCard>
      </section>
    </>
  );
}
