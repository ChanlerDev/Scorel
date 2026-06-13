import type { GuiProjectRef, GuiRuntimeSettingsView } from "../../../shared/ipc.js";
import { SettingsCard } from "../SettingsCard.js";
import { SettingsHeader } from "../SettingsHeader.js";
import { SettingsRow } from "../SettingsRow.js";
import { Toggle } from "../controls/Toggle.js";

export type RuntimeSectionProps = {
  project: GuiProjectRef | null;
  runtime: GuiRuntimeSettingsView;
  busy: boolean;
  setBusy(value: boolean): void;
  setError(message: string | null): void;
  onRuntimeChange(runtime: GuiRuntimeSettingsView): void;
};

export function RuntimeSection(props: RuntimeSectionProps) {
  const update = async (patch: Partial<Pick<GuiRuntimeSettingsView, "tokenSavingRtk">>): Promise<void> => {
    if (!props.project) return;
    props.setBusy(true);
    try {
      const next = await window.scorel.upsertRuntimeSettings(props.project, patch);
      props.onRuntimeChange(next);
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
      <SettingsHeader title="Token 节省" subtitle="使用 RTK 压缩 Bash 工具输出，减少进入模型上下文的命令噪声。" />
      <section className="settings-section settings-section--wide">
        <SettingsCard>
          <SettingsRow
            label="RTK 状态"
            description={rtkDescription(props.runtime)}
            control={<span className="settings-status-pill">{props.runtime.rtkAvailable ? "已可用" : "未可用"}</span>}
          />
          <SettingsRow
            label="启用 RTK"
            description="开启后，Scorel 会在 Bash 执行路径使用 RTK rewrite；首次开启会尝试安装 RTK。"
            control={<Toggle checked={props.runtime.tokenSavingRtk} disabled={disabled} onChange={(tokenSavingRtk) => void update({ tokenSavingRtk })} ariaLabel="启用 RTK" />}
          />
          <SettingsRow
            label="Scorel saved tokens"
            description={`RTK savings recorded by Scorel sessions on this host. Output ${formatNumber(props.runtime.estimatedOutputTokens)} tokens.`}
            control={<span className="settings-value">{formatNumber(props.runtime.estimatedSavedTokens)}</span>}
          />
        </SettingsCard>
      </section>
    </>
  );
}

const rtkDescription = (runtime: GuiRuntimeSettingsView): string => {
  const parts = [
    runtime.rtkExecutable ?? "rtk not found on PATH",
    runtime.rtkVersion,
    runtime.installStatus === "failed" ? runtime.installMessage : undefined,
  ].filter(Boolean);
  return parts.join(" · ");
};

const formatNumber = (value: number): string =>
  new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value);
