import { useMemo, useState } from "react";

import type { GuiModelProfileView, GuiProjectRef, GuiUpsertModelProfileInput } from "../../../shared/ipc.js";
import { SettingsCard } from "../SettingsCard.js";
import { SettingsHeader } from "../SettingsHeader.js";
import { SettingsRow } from "../SettingsRow.js";

export type ModelSectionProps = {
  project: GuiProjectRef | null;
  modelProfile: GuiModelProfileView;
  busy: boolean;
  setBusy(value: boolean): void;
  setError(message: string | null): void;
  onModelProfileChange(profile: GuiModelProfileView): void;
};

type AvailableModelForm = {
  availableModelId: string;
  providerModelKey: string;
  displayName: string;
};

const DEFAULT_AVAILABLE_MODEL_FORM: AvailableModelForm = {
  availableModelId: "main",
  providerModelKey: "chanleramp_deepseek_flash",
  displayName: "DeepSeek Flash",
};

const roleLabels = {
  primary: "Primary",
  standard: "Standard",
  auxiliary: "Auxiliary",
} as const;

export function ModelSection({
  project,
  modelProfile,
  busy,
  setBusy,
  setError,
  onModelProfileChange,
}: ModelSectionProps) {
  const [availableModelForm, setAvailableModelForm] = useState<AvailableModelForm>(DEFAULT_AVAILABLE_MODEL_FORM);
  const [rolesForm, setRolesForm] = useState(modelProfile.roles);

  const providerModelById = useMemo(
    () => new Map(modelProfile.providerModels.map((model) => [model.providerModelId, model])),
    [modelProfile.providerModels],
  );
  const roleOptions = modelProfile.models.map((model) => model.modelId);
  const roles = {
    primary: rolesForm.primary || modelProfile.roles.primary,
    standard: rolesForm.standard || modelProfile.roles.standard,
    auxiliary: rolesForm.auxiliary || modelProfile.roles.auxiliary,
  };

  const save = async (input: GuiUpsertModelProfileInput): Promise<void> => {
    if (!project) return;
    setBusy(true);
    try {
      const profile = await window.scorel.upsertModelProfile(project, input);
      onModelProfileChange(profile);
      setRolesForm(profile.roles);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const stageProviderModel = (providerModelId: string): void => {
    const providerModel = providerModelById.get(providerModelId);
    setAvailableModelForm({
      availableModelId: providerModel ? identifierFromModelId(providerModel.id) : providerModelId,
      providerModelKey: providerModelId,
      displayName: providerModel?.displayName ?? providerModelId,
    });
  };

  const saveAvailableModel = (): Promise<void> =>
    save({
      providerModelKey: availableModelForm.providerModelKey,
      availableModelId: availableModelForm.availableModelId,
      displayName: availableModelForm.displayName,
      addToAvailable: true,
    });

  const saveRoles = (): Promise<void> => save({ roles });

  return (
    <>
      <SettingsHeader
        title="模型"
        subtitle="选择三个实际工作模型，并维护允许 Scorel 使用的 available models。"
      />

      {modelProfile.warnings?.map((warning) => (
        <section className="settings-section settings-section--wide" key={warning}>
          <SettingsCard>
            <div className="settings-empty">{warning}</div>
          </SettingsCard>
        </section>
      ))}

      <section className="settings-section settings-section--wide">
        <h2 className="settings-section__title">Working Models</h2>
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
                  <span className="model-role-card__meta">{model ? `${model.modelId} / ${providerName(model.provider)}/${model.id}` : "从 available models 中选择"}</span>
                </label>
              );
            })}
          </div>
          <div className="settings-card__head">
            <span className="settings-value">Runtime、composer 和 subagent 只使用这里选出的角色模型。</span>
            <button type="button" className="button button--primary" disabled={busy || !project || roleOptions.length === 0} onClick={() => void saveRoles()}>
              保存 working models
            </button>
          </div>
        </SettingsCard>
      </section>

      <section className="settings-section settings-section--wide">
        <h2 className="settings-section__title">Available Models</h2>
        <SettingsCard>
          {modelProfile.models.length === 0 ? (
            <div className="settings-empty">还没有模型进入 use pool。先从 Provider 页添加 provider model。</div>
          ) : (
            modelProfile.models.map((model) => (
              <SettingsRow
                key={model.modelId}
                label={model.displayName}
                description={`${model.modelId} / ${model.providerModelId} / ${providerName(model.provider)}/${model.id}`}
                control={<span className="settings-value">{model.roles.length > 0 ? model.roles.join(", ") : "未分配角色"}</span>}
              />
            ))
          )}
          <div className="settings-form settings-form--compact">
            <label>
              <span>Available model id</span>
              <input className="input-text" value={availableModelForm.availableModelId} onChange={(event) => setAvailableModelForm({ ...availableModelForm, availableModelId: event.currentTarget.value })} />
            </label>
            <label>
              <span>Provider model</span>
              <select className="input-text" value={availableModelForm.providerModelKey} onChange={(event) => stageProviderModel(event.currentTarget.value)}>
                <option value={availableModelForm.providerModelKey}>{availableModelForm.providerModelKey}</option>
                {modelProfile.providerModels.map((model) => (
                  <option key={model.providerModelId} value={model.providerModelId}>{model.displayName}</option>
                ))}
              </select>
            </label>
            <label>
              <span>Display name</span>
              <input className="input-text" value={availableModelForm.displayName} onChange={(event) => setAvailableModelForm({ ...availableModelForm, displayName: event.currentTarget.value })} />
            </label>
            <button type="button" className="button button--primary" disabled={busy || !project} onClick={() => void saveAvailableModel()}>
              加入 available models
            </button>
          </div>
        </SettingsCard>
      </section>
    </>
  );
}

const providerName = (value: string): string => value.split("/")[0]?.trim() || value.trim();
const identifierFromModelId = (value: string): string => value.replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "model";
