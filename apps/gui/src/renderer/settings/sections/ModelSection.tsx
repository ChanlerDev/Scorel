import { useEffect, useState } from "react";

import type { GuiDeviceRef, GuiModelProfileView, GuiUpsertModelProfileInput } from "../../../shared/ipc.js";
import { SettingsCard } from "../SettingsCard.js";
import { SettingsHeader } from "../SettingsHeader.js";
import { SettingsRow } from "../SettingsRow.js";

export type ModelSectionProps = {
  device: GuiDeviceRef;
  modelProfile: GuiModelProfileView;
  busy: boolean;
  setBusy(value: boolean): void;
  setError(message: string | null): void;
  onModelProfileChange(profile: GuiModelProfileView): void;
};

const roleLabels = {
  primary: "主力",
  standard: "默认",
  auxiliary: "辅助",
} as const;

export function ModelSection({
  device,
  modelProfile,
  busy,
  setBusy,
  setError,
  onModelProfileChange,
}: ModelSectionProps) {
  const [rolesForm, setRolesForm] = useState(modelProfile.roles);
  const roleOptions = modelProfile.models.map((model) => model.modelId);
  const roles = {
    primary: rolesForm.primary || modelProfile.roles.primary,
    standard: rolesForm.standard || modelProfile.roles.standard,
    auxiliary: rolesForm.auxiliary || modelProfile.roles.auxiliary,
  };

  const save = async (input: GuiUpsertModelProfileInput): Promise<void> => {
    setBusy(true);
    try {
      const profile = await window.scorel.upsertModelProfile(device, input);
      onModelProfileChange(profile);
      setRolesForm(profile.roles);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const saveRoles = (): Promise<void> => save({ roles });

  useEffect(() => {
    setRolesForm(modelProfile.roles);
  }, [deviceScopeKey(device), modelProfile.roles]);

  return (
    <>
      <SettingsHeader
        title="模型"
        subtitle="选择 Scorel 实际使用的工作模型。模型在 Provider 页选用和配置。"
      />

      {modelProfile.warnings?.map((warning) => (
        <section className="settings-section settings-section--wide" key={warning}>
          <SettingsCard>
            <div className="settings-empty">{warning}</div>
          </SettingsCard>
        </section>
      ))}

      <section className="settings-section settings-section--wide">
        <h2 className="settings-section__title">工作模型</h2>
        <SettingsCard>
          <div className="model-role-grid">
            {(["primary", "standard", "auxiliary"] as const).map((role) => {
              const modelId = roles[role];
              const model = modelProfile.models.find((candidate) => candidate.modelId === modelId);
              return (
                <label className="model-role-card" key={role}>
                  <span className="model-role-card__label">{roleLabels[role]}</span>
                  <select
                    className="input-text"
                    value={modelId}
                    onChange={(event) => setRolesForm({ ...roles, [role]: event.currentTarget.value })}
                  >
                    <option value="">未配置</option>
                    {modelProfile.models.map((candidate) => (
                      <option key={candidate.modelId} value={candidate.modelId}>{candidate.displayName}</option>
                    ))}
                  </select>
                  <span className="model-role-card__meta">{model ? `${providerName(model.provider)} / ${model.id}` : "先添加可用模型"}</span>
                </label>
              );
            })}
          </div>
          <div className="settings-card__head">
            <span className="settings-value">主对话默认使用“默认”模型，标题等轻量任务使用“辅助”模型。</span>
            <button type="button" className="button button--primary" disabled={busy || roleOptions.length === 0} onClick={() => void saveRoles()}>
              保存工作模型
            </button>
          </div>
        </SettingsCard>
      </section>

      <section className="settings-section settings-section--wide">
        <h2 className="settings-section__title">已选用模型</h2>
        <SettingsCard>
          {modelProfile.models.length === 0 ? (
            <div className="settings-empty">还没有已选用模型。先到 Provider 页获取或手动添加模型，然后打开选用开关。</div>
          ) : (
            modelProfile.models.map((model) => (
              <SettingsRow
                key={model.modelId}
                label={model.displayName}
                description={`${providerName(model.provider)} / ${model.id}`}
                control={<span className="settings-value">{model.roles.length > 0 ? model.roles.map((role) => roleLabels[role]).join(", ") : "未分配"}</span>}
              />
            ))
          )}
        </SettingsCard>
      </section>
    </>
  );
}

const providerName = (value: string): string => value.split("/")[0]?.trim() || value.trim();

const deviceScopeKey = (device: GuiDeviceRef): string =>
  device.source === "relay" ? `relay:${device.deviceId ?? ""}` : "local";
