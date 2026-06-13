import { useEffect, useMemo, useState } from "react";

import type { GuiModelProfileView, GuiProjectRef, GuiProviderCatalogModelView, GuiUpsertModelProfileInput } from "../../../shared/ipc.js";
import { Check, Settings as SettingsIcon, X } from "../../icons/index.js";
import { SettingsCard } from "../SettingsCard.js";
import { SettingsHeader } from "../SettingsHeader.js";

export type ProviderSectionProps = {
  project: GuiProjectRef | null;
  modelProfile: GuiModelProfileView;
  busy: boolean;
  setBusy(value: boolean): void;
  setError(message: string | null): void;
  onModelProfileChange(profile: GuiModelProfileView): void;
};

type ProviderForm = {
  providerId: string;
  providerType: "builtin" | "custom";
  provider: string;
  api: GuiUpsertModelProfileInput["api"];
  baseUrl: string;
  credentialMode: "env" | "direct";
  apiKeyEnv: string;
  apiKey: string;
};

type ProviderModelForm = {
  providerId: string;
  providerModelKey: string;
  providerModelId: string;
  displayName: string;
  contextWindow: string;
  maxTokens: string;
  reasoning: boolean;
  supportsDeveloperRole: boolean;
  supportsImageInput: boolean;
};

type ProviderModelCard = {
  providerModelKey: string;
  id: string;
  displayName: string;
  configured: boolean;
  selected: boolean;
  availableModelIds: string[];
  contextWindow?: number;
  maxTokens?: number;
  reasoning?: boolean;
  supportsDeveloperRole?: boolean;
  supportsImageInput?: boolean;
};

type ModelTestState = "idle" | "pass" | "fail";

const DEFAULT_PROVIDER_FORM: ProviderForm = {
  providerId: "",
  providerType: "custom",
  provider: "",
  api: "openai-completions",
  baseUrl: "",
  credentialMode: "direct",
  apiKeyEnv: "",
  apiKey: "",
};

const DEFAULT_PROVIDER_MODEL_FORM: ProviderModelForm = {
  providerId: "",
  providerModelKey: "",
  providerModelId: "",
  displayName: "",
  contextWindow: "200000",
  maxTokens: "64000",
  reasoning: true,
  supportsDeveloperRole: false,
  supportsImageInput: false,
};

export function ProviderSection({
  project,
  modelProfile,
  busy,
  setBusy,
  setError,
  onModelProfileChange,
}: ProviderSectionProps) {
  const [providerForm, setProviderForm] = useState<ProviderForm>(() => providerToForm(modelProfile.providers[0]) ?? DEFAULT_PROVIDER_FORM);
  const [providerModelForm, setProviderModelForm] = useState<ProviderModelForm>(() => providerModelToForm(modelProfile.providerModels[0], modelProfile.providers[0]?.providerId) ?? DEFAULT_PROVIDER_MODEL_FORM);
  const [selectedProviderId, setSelectedProviderId] = useState(modelProfile.providers[0]?.providerId ?? "");
  const [catalogModels, setCatalogModels] = useState<GuiProviderCatalogModelView[]>([]);
  const [catalogQuery, setCatalogQuery] = useState("");
  const [configModel, setConfigModel] = useState<ProviderModelCard | null>(null);
  const [modelTestStates, setModelTestStates] = useState<Record<string, ModelTestState>>({});
  const [modelTestMessage, setModelTestMessage] = useState<string | null>(null);
  const [newProviderForm, setNewProviderForm] = useState<ProviderForm>(newProviderDraft());
  const [newProviderModalOpen, setNewProviderModalOpen] = useState(false);

  const providerById = useMemo(
    () => new Map(modelProfile.providers.map((provider) => [provider.providerId, provider])),
    [modelProfile.providers],
  );
  const selectedProvider = selectedProviderId ? providerById.get(selectedProviderId) ?? modelProfile.providers[0] : undefined;
  useEffect(() => {
    if (selectedProviderId || modelProfile.providers.length === 0) return;
    const firstProvider = modelProfile.providers[0];
    setSelectedProviderId(firstProvider.providerId);
    setProviderForm(providerToForm(firstProvider) ?? DEFAULT_PROVIDER_FORM);
  }, [modelProfile.providers, selectedProviderId]);
  const selectedProviderModels = modelProfile.providerModels.filter((model) => model.providerId === selectedProvider?.providerId);
  const availableProviderModelIds = new Set(modelProfile.models.map((model) => model.providerModelId));
  const modelCards: ProviderModelCard[] = [
    ...selectedProviderModels.map((model) => ({
      providerModelKey: model.providerModelId,
      id: model.id,
      displayName: model.displayName,
      configured: true,
      selected: availableProviderModelIds.has(model.providerModelId),
      availableModelIds: model.availableModelIds,
      contextWindow: model.contextWindow,
      maxTokens: model.maxTokens,
      reasoning: model.reasoning,
      supportsDeveloperRole: model.supportsDeveloperRole,
      supportsImageInput: model.supportsImageInput,
    })),
    ...catalogModels
      .filter((model) => !selectedProviderModels.some((configured) => configured.id === model.id))
      .map((model) => ({
        providerModelKey: `${selectedProvider?.providerId ?? providerForm.providerId}_${identifierFromModelId(model.id)}`,
        id: model.id,
        displayName: model.displayName,
        configured: false,
        selected: false,
        availableModelIds: [],
      })),
  ];
  const filteredModelCards = modelCards.filter((model) => {
    const query = catalogQuery.trim().toLowerCase();
    if (!query) return true;
    return [model.displayName, model.providerModelKey, model.id].some((value) => value.toLowerCase().includes(query));
  });

  const save = async (input: GuiUpsertModelProfileInput): Promise<void> => {
    if (!project) return;
    setBusy(true);
    try {
      const profile = await window.scorel.upsertModelProfile(project, input);
      onModelProfileChange(profile);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const selectProvider = (providerId: string): void => {
    const provider = providerById.get(providerId);
    setSelectedProviderId(providerId);
    setCatalogModels([]);
    setConfigModel(null);
    setModelTestMessage(null);
    setProviderModelForm((current) => ({ ...current, providerId }));
    if (!provider) return;
    setProviderForm(providerToForm(provider) ?? DEFAULT_PROVIDER_FORM);
  };

  const newProvider = (): void => {
    setNewProviderForm(newProviderDraft());
    setNewProviderModalOpen(true);
  };

  const saveProvider = (form: ProviderForm): Promise<void> =>
    save(providerInput(form));

  const removeSelectedProvider = async (): Promise<void> => {
    if (!project || !selectedProvider || busy) return;
    setBusy(true);
    try {
      const profile = await window.scorel.removeModelProvider(project, selectedProvider.providerId);
      onModelProfileChange(profile);
      const nextProvider = profile.providers[0];
      setSelectedProviderId(nextProvider?.providerId ?? "");
      setProviderForm(providerToForm(nextProvider) ?? DEFAULT_PROVIDER_FORM);
      setProviderModelForm(providerModelToForm(profile.providerModels[0], nextProvider?.providerId) ?? DEFAULT_PROVIDER_MODEL_FORM);
      setCatalogModels([]);
      setConfigModel(null);
      setModelTestMessage(null);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const saveNewProvider = async (): Promise<void> => {
    if (!project) return;
    const input = providerInput(newProviderForm);
    setBusy(true);
    try {
      const profile = await window.scorel.upsertModelProfile(project, input);
      onModelProfileChange(profile);
      setSelectedProviderId(input.providerId ?? "");
      setProviderForm({ ...newProviderForm, provider: providerName(newProviderForm.provider), apiKey: "" });
      setProviderModelForm({ ...DEFAULT_PROVIDER_MODEL_FORM, providerId: input.providerId ?? "", providerModelKey: `${input.providerId ?? "provider"}_model`, providerModelId: "", displayName: "" });
      setCatalogModels([]);
      setConfigModel(null);
      setNewProviderModalOpen(false);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const saveProviderModel = (form = providerModelForm): Promise<void> =>
    save({
      providerId: form.providerId || selectedProvider?.providerId || providerForm.providerId,
      providerModelKey: form.providerModelKey || providerModelKey(form.providerId || selectedProvider?.providerId || providerForm.providerId, form.providerModelId),
      providerModelId: form.providerModelId,
      displayName: form.displayName || form.providerModelId,
      ...modelParameterInput(form),
    });

  const toggleProviderModelAvailable = (model: ProviderModelCard): Promise<void> => {
    const editing = configModel?.providerModelKey === model.providerModelKey;
    const providerModelKey = editing ? providerModelForm.providerModelKey : model.providerModelKey;
    const providerModelId = editing ? providerModelForm.providerModelId : model.id;
    const displayName = editing ? providerModelForm.displayName || model.displayName : model.displayName;
    const defaultForm = providerModelToForm({
      providerModelId: model.providerModelKey,
      providerId: selectedProvider?.providerId ?? providerForm.providerId,
      provider: selectedProvider?.provider ?? providerForm.provider,
      id: providerModelId,
      displayName,
      availableModelIds: model.availableModelIds,
      contextWindow: model.contextWindow,
      maxTokens: model.maxTokens,
      reasoning: model.reasoning,
      supportsDeveloperRole: model.supportsDeveloperRole,
      supportsImageInput: model.supportsImageInput,
    }, selectedProvider?.providerId) ?? DEFAULT_PROVIDER_MODEL_FORM;
    const availableModelId = model.availableModelIds[0] ?? identifierFromModelId(providerModelId);
    if (model.selected) {
      return save({
        providerId: selectedProvider?.providerId ?? providerForm.providerId,
        providerModelKey,
        providerModelId,
        displayName,
        removeAvailableModelId: availableModelId,
        ...(editing ? modelParameterInput(providerModelForm) : {}),
      });
    }
    return save({
      providerId: selectedProvider?.providerId ?? providerForm.providerId,
      providerModelKey,
      providerModelId,
      displayName,
      availableModelId,
      addToAvailable: true,
      ...modelParameterInput(editing ? providerModelForm : defaultForm),
    });
  };

  const fetchProviderModels = async (): Promise<void> => {
    await fetchProviderCatalog();
  };

  const testProviderModel = async (model: ProviderModelCard): Promise<void> => {
    setModelTestStates((current) => ({ ...current, [model.providerModelKey]: "idle" }));
    setModelTestMessage(null);
    const models = await fetchProviderCatalog();
    if (!models.some((candidate) => candidate.id === model.id)) {
      setModelTestStates((current) => ({ ...current, [model.providerModelKey]: "fail" }));
      setModelTestMessage(`测试失败：Provider 未返回模型 ${model.id}`);
      setError(`Provider 未返回模型: ${model.id}`);
      return;
    }
    setModelTestStates((current) => ({ ...current, [model.providerModelKey]: "pass" }));
    setModelTestMessage(`测试通过：Provider 返回了 ${model.id}`);
  };

  const fetchProviderCatalog = async (): Promise<GuiProviderCatalogModelView[]> => {
    if (!project || !selectedProvider) return [];
    setBusy(true);
    try {
      const models = await window.scorel.fetchProviderModels(project, selectedProvider.providerId);
      setCatalogModels(models);
      setError(null);
      return models;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      return [];
    } finally {
      setBusy(false);
    }
  };

  const openModelConfig = (model: ProviderModelCard): void => {
    setConfigModel(model);
    setProviderModelForm(providerModelToForm({
      providerModelId: model.providerModelKey,
      providerId: selectedProvider?.providerId ?? providerForm.providerId,
      provider: selectedProvider?.provider ?? providerForm.provider,
      id: model.id,
      displayName: model.displayName,
      availableModelIds: model.availableModelIds,
      contextWindow: model.contextWindow,
      maxTokens: model.maxTokens,
      reasoning: model.reasoning,
      supportsDeveloperRole: model.supportsDeveloperRole,
      supportsImageInput: model.supportsImageInput,
    }, selectedProvider?.providerId) ?? DEFAULT_PROVIDER_MODEL_FORM);
  };

  const updateModelForm = (patch: Partial<ProviderModelForm>): ProviderModelForm => {
    const next = { ...providerModelForm, ...patch };
    setProviderModelForm(next);
    return next;
  };

  const autoSaveProvider = (form = providerForm): void => {
    if (!project || busy) return;
    void saveProvider(form);
  };

  const autoSaveModel = (form = providerModelForm): void => {
    if (!project || busy || !form.providerModelId.trim()) return;
    void saveProviderModel(form);
  };

  return (
    <>
      <SettingsHeader
        title="Provider"
        subtitle="配置模型服务提供商，然后从它的模型列表中选择 Scorel 可使用的模型。"
      />

      {modelProfile.warnings?.map((warning) => (
        <section className="settings-section settings-section--wide" key={warning}>
          <SettingsCard>
            <div className="settings-empty">{warning}</div>
          </SettingsCard>
        </section>
      ))}

      <section className="settings-section settings-section--wide">
        <h2 className="settings-section__title">提供商</h2>
        <SettingsCard>
          <div className="provider-management">
            <aside className="provider-list" aria-label="Provider list">
              {modelProfile.providers.length === 0 ? (
                <div className="settings-empty">还没有提供商。</div>
              ) : (
                modelProfile.providers.map((provider) => (
                  <button
                    type="button"
                    className={provider.providerId === selectedProvider?.providerId ? "provider-list__item provider-list__item--active" : "provider-list__item"}
                    key={provider.providerId}
                    onClick={() => selectProvider(provider.providerId)}
                  >
                    <span>{providerName(provider.provider)}</span>
                    <small>{credentialText(provider)}</small>
                  </button>
                ))
              )}
              <button type="button" className="button provider-list__add" onClick={newProvider}>
                新建提供商
              </button>
            </aside>

            <div className="provider-detail">
              <div className="provider-detail__scroll">
                <div className="settings-form settings-form--compact">
                  <label>
                    <span>提供商名称</span>
                    <input
                      className="input-text"
                      value={providerForm.provider}
                      onChange={(event) => setProviderForm({ ...providerForm, provider: event.currentTarget.value })}
                      onBlur={() => {
                        const next = { ...providerForm, provider: providerName(providerForm.provider) };
                        setProviderForm(next);
                        autoSaveProvider(next);
                      }}
                    />
                  </label>
                  <label>
                    <span>Base URL</span>
                    <input className="input-text" value={providerForm.baseUrl} onChange={(event) => setProviderForm({ ...providerForm, baseUrl: event.currentTarget.value })} onBlur={() => autoSaveProvider()} />
                  </label>
                  <label>
                    <span>API Key</span>
                    <select
                      className="input-text"
                      value={providerForm.credentialMode}
                      onChange={(event) => {
                        const next = { ...providerForm, credentialMode: event.currentTarget.value as ProviderForm["credentialMode"] };
                        setProviderForm(next);
                        autoSaveProvider(next);
                      }}
                    >
                      <option value="direct">直接填写</option>
                      <option value="env">环境变量</option>
                    </select>
                  </label>
                  {providerForm.credentialMode === "env" ? (
                    <label>
                      <span>环境变量名</span>
                      <input className="input-text" value={providerForm.apiKeyEnv} onChange={(event) => setProviderForm({ ...providerForm, apiKeyEnv: event.currentTarget.value })} onBlur={() => autoSaveProvider()} />
                    </label>
                  ) : (
                    <label>
                      <span>API key</span>
                      <input className="input-text" type="password" placeholder="已配置则留空保留" value={providerForm.apiKey} onChange={(event) => setProviderForm({ ...providerForm, apiKey: event.currentTarget.value })} onBlur={() => autoSaveProvider()} />
                    </label>
                  )}
                </div>

                <div className="provider-catalog">
                  <div className="settings-card__head">
                    <span className="settings-section__title">模型列表</span>
                    <div className="settings-card__head-meta">
                      <input className="input-text provider-catalog__search" placeholder="搜索模型" value={catalogQuery} onChange={(event) => setCatalogQuery(event.currentTarget.value)} />
                      <span className="settings-value">{filteredModelCards.length}/{modelCards.length} models</span>
                      <button type="button" className="button" disabled={busy || !project || !selectedProvider} onClick={() => void fetchProviderModels()}>
                        获取模型
                      </button>
                    </div>
                  </div>
                  {modelCards.length === 0 ? (
                    <div className="settings-empty">点击右上角获取模型，也可以手动添加模型。</div>
                  ) : filteredModelCards.length === 0 ? (
                    <div className="settings-empty">没有匹配的模型。</div>
                  ) : (
                    <>
                      {modelTestMessage ? <div className="provider-catalog__message">{modelTestMessage}</div> : null}
                      <div className="provider-model-card-list">
                        {filteredModelCards.map((model) => (
                          <div className="provider-model-card" key={model.providerModelKey}>
                            <div className="provider-model-card__summary">
                              <span>
                                <strong>{model.displayName}</strong>
                                <small>{selectedProvider ? `${providerName(selectedProvider.provider)} / ${model.id}` : model.id}</small>
                              </span>
                              <span className="provider-model-card__meta">
                                {model.selected ? "已选用" : model.configured ? "已登记" : "来自 provider"}
                              </span>
                            </div>
                            <div className="provider-model-card__actions">
                              <button type="button" className={testButtonClass(modelTestStates[model.providerModelKey])} disabled={busy || !project || !selectedProvider} onClick={() => void testProviderModel(model)} title="测试模型" aria-label="测试模型">
                                {modelTestStates[model.providerModelKey] === "pass" ? <Check size={14} /> : modelTestStates[model.providerModelKey] === "fail" ? <X size={14} /> : <span>测</span>}
                              </button>
                              <button type="button" className="provider-model-card__config-button" onClick={() => openModelConfig(model)} title="配置" aria-label="配置">
                                <SettingsIcon size={14} />
                                <span>配置</span>
                              </button>
                              <button type="button" className={model.selected ? "button button--selected" : "button"} disabled={busy || !project} onClick={() => void toggleProviderModelAvailable(model)}>
                                {model.selected ? "取消选用" : "选用"}
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                  <details className="provider-manual-model">
                    <summary>手动添加模型</summary>
                    <div className="settings-form settings-form--compact">
                      <label>
                        <span>Model ID</span>
                        <input className="input-text" value={providerModelForm.providerModelId} onChange={(event) => setProviderModelForm({ ...providerModelForm, providerModelId: event.currentTarget.value })} />
                      </label>
                      <label>
                        <span>模型名称</span>
                        <input className="input-text" value={providerModelForm.displayName} onChange={(event) => setProviderModelForm({ ...providerModelForm, displayName: event.currentTarget.value })} />
                      </label>
                      <button type="button" className="button button--primary" disabled={busy || !project} onClick={() => void saveProviderModel()}>
                        保存模型
                      </button>
                    </div>
                  </details>
                </div>
                {selectedProvider ? (
                  <div className="provider-danger-zone">
                    <span>危险操作</span>
                    <button type="button" className="button button--danger" disabled={busy || !project} onClick={() => void removeSelectedProvider()}>
                      删除提供商
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </SettingsCard>
      </section>
      {configModel ? (
        <div className="modal" onMouseDown={() => setConfigModel(null)} role="dialog" aria-label="Model configuration">
          <div className="modal__panel provider-modal" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal__header">
              <h2 className="modal__title">配置模型</h2>
              <button type="button" className="modal__icon-button" onClick={() => setConfigModel(null)} aria-label="Close">x</button>
            </div>
            <p className="modal__subtitle">{selectedProvider ? `${providerName(selectedProvider.provider)} / ${providerModelForm.providerModelId}` : providerModelForm.providerModelId}</p>
            <div className="settings-form settings-form--compact provider-modal__form">
              <label>
                <span>模型名称</span>
                <input className="input-text" value={providerModelForm.displayName} onChange={(event) => updateModelForm({ displayName: event.currentTarget.value })} onBlur={() => autoSaveModel()} />
              </label>
              <label>
                <span>Model ID</span>
                <input className="input-text" value={providerModelForm.providerModelId} onChange={(event) => updateModelForm({ providerModelId: event.currentTarget.value })} onBlur={() => autoSaveModel()} />
              </label>
              <label>
                <span>Context</span>
                <input className="input-text" inputMode="numeric" value={providerModelForm.contextWindow} onChange={(event) => updateModelForm({ contextWindow: event.currentTarget.value })} onBlur={() => autoSaveModel()} />
              </label>
              <label>
                <span>Max Tokens</span>
                <input className="input-text" inputMode="numeric" value={providerModelForm.maxTokens} onChange={(event) => updateModelForm({ maxTokens: event.currentTarget.value })} onBlur={() => autoSaveModel()} />
              </label>
              <label className="provider-model-card__checkbox">
                <input
                  type="checkbox"
                  checked={providerModelForm.reasoning}
                  onChange={(event) => {
                    const next = updateModelForm({ reasoning: event.currentTarget.checked });
                    autoSaveModel(next);
                  }}
                />
                <span>Reasoning</span>
              </label>
              <label className="provider-model-card__checkbox">
                <input
                  type="checkbox"
                  checked={providerModelForm.supportsDeveloperRole}
                  onChange={(event) => {
                    const next = updateModelForm({ supportsDeveloperRole: event.currentTarget.checked });
                    autoSaveModel(next);
                  }}
                />
                <span>Developer Role</span>
              </label>
              <label className="provider-model-card__checkbox">
                <input
                  type="checkbox"
                  checked={providerModelForm.supportsImageInput}
                  onChange={(event) => {
                    const next = updateModelForm({ supportsImageInput: event.currentTarget.checked });
                    autoSaveModel(next);
                  }}
                />
                <span>图片输入</span>
              </label>
            </div>
          </div>
        </div>
      ) : null}
      {newProviderModalOpen ? (
        <div className="modal" onMouseDown={() => setNewProviderModalOpen(false)} role="dialog" aria-label="New provider">
          <div className="modal__panel provider-modal" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal__header">
              <h2 className="modal__title">新建提供商</h2>
              <button type="button" className="modal__icon-button" onClick={() => setNewProviderModalOpen(false)} aria-label="Close">x</button>
            </div>
            <p className="modal__subtitle">添加一个模型服务提供商。取消不会写入配置。</p>
            <ProviderFormFields form={newProviderForm} setForm={setNewProviderForm} />
            <div className="modal__footer">
              <button type="button" className="button" onClick={() => setNewProviderModalOpen(false)}>取消</button>
              <button type="button" className="button button--primary" disabled={busy || !project} onClick={() => void saveNewProvider()}>
                保存提供商
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function ProviderFormFields({ form, setForm }: { form: ProviderForm; setForm(form: ProviderForm): void }) {
  return (
    <div className="settings-form settings-form--compact provider-modal__form">
      <label>
        <span>提供商名称</span>
        <input className="input-text" value={form.provider} onChange={(event) => setForm({ ...form, provider: event.currentTarget.value })} onBlur={() => setForm({ ...form, provider: providerName(form.provider) })} />
      </label>
      <label>
        <span>Base URL</span>
        <input className="input-text" value={form.baseUrl} onChange={(event) => setForm({ ...form, baseUrl: event.currentTarget.value })} />
      </label>
      <label>
        <span>API Key</span>
        <select className="input-text" value={form.credentialMode} onChange={(event) => setForm({ ...form, credentialMode: event.currentTarget.value as ProviderForm["credentialMode"] })}>
          <option value="direct">直接填写</option>
          <option value="env">环境变量</option>
        </select>
      </label>
      {form.credentialMode === "env" ? (
        <label>
          <span>环境变量名</span>
          <input className="input-text" value={form.apiKeyEnv} onChange={(event) => setForm({ ...form, apiKeyEnv: event.currentTarget.value })} />
        </label>
      ) : (
        <label>
          <span>API key</span>
          <input className="input-text" type="password" value={form.apiKey} onChange={(event) => setForm({ ...form, apiKey: event.currentTarget.value })} />
        </label>
      )}
    </div>
  );
}

const providerInput = (form: ProviderForm): GuiUpsertModelProfileInput => ({
  providerId: form.providerId || identifierFromProviderName(form.provider),
  providerType: form.providerType,
  provider: providerName(form.provider),
  ...(form.credentialMode === "direct" ? { apiKey: form.apiKey } : { apiKeyEnv: form.apiKeyEnv }),
  ...(form.providerType === "custom" ? { api: form.api, baseUrl: form.baseUrl } : {}),
});

const modelParameterInput = (form: ProviderModelForm): Pick<GuiUpsertModelProfileInput, "contextWindow" | "maxTokens" | "reasoning" | "supportsDeveloperRole" | "supportsImageInput"> => ({
  ...(form.contextWindow.trim() ? { contextWindow: Number(form.contextWindow.trim()) } : {}),
  ...(form.maxTokens.trim() ? { maxTokens: Number(form.maxTokens.trim()) } : {}),
  reasoning: form.reasoning,
  supportsDeveloperRole: form.supportsDeveloperRole,
  supportsImageInput: form.supportsImageInput,
});

const testButtonClass = (state: ModelTestState | undefined): string => {
  if (state === "pass") return "provider-model-card__test-button provider-model-card__test-button--pass";
  if (state === "fail") return "provider-model-card__test-button provider-model-card__test-button--fail";
  return "provider-model-card__test-button";
};

const newProviderDraft = (): ProviderForm => ({
  ...DEFAULT_PROVIDER_FORM,
});

const providerName = (value: string): string => value.split("/")[0]?.trim() || value.trim();
const identifierFromModelId = (value: string): string => value.replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "model";
const identifierFromProviderName = (value: string): string => identifierFromModelId(providerName(value).toLowerCase());
const providerModelKey = (providerId: string, modelId: string): string => `${providerId || "provider"}_${identifierFromModelId(modelId)}`;

const providerModelToForm = (
  model: GuiModelProfileView["providerModels"][number] | undefined,
  providerId: string | undefined,
): ProviderModelForm | undefined => {
  if (!model) return undefined;
  return {
    providerId: model.providerId || providerId || "",
    providerModelKey: model.providerModelId,
    providerModelId: model.id,
    displayName: model.displayName,
    contextWindow: model.contextWindow?.toString() ?? DEFAULT_PROVIDER_MODEL_FORM.contextWindow,
    maxTokens: model.maxTokens?.toString() ?? DEFAULT_PROVIDER_MODEL_FORM.maxTokens,
    reasoning: model.reasoning ?? DEFAULT_PROVIDER_MODEL_FORM.reasoning,
    supportsDeveloperRole: model.supportsDeveloperRole ?? false,
    supportsImageInput: model.supportsImageInput ?? false,
  };
};

const providerToForm = (provider: GuiModelProfileView["providers"][number] | undefined): ProviderForm | undefined => {
  if (!provider) return undefined;
  return {
    providerId: provider.providerId,
    providerType: provider.type,
    provider: providerName(provider.provider),
    api: provider.api ?? "openai-completions",
    baseUrl: provider.baseUrl ?? "",
    credentialMode: provider.credentialSource,
    apiKeyEnv: provider.apiKeyEnv ?? "",
    apiKey: "",
  };
};

const credentialText = (provider: GuiModelProfileView["providers"][number]): string => {
  if (provider.credentialStatus !== "available") {
    return "缺少 API Key";
  }
  if (provider.credentialSource === "direct") {
    return "已配置 API Key";
  }
  return provider.apiKeyEnv ? `环境变量: ${provider.apiKeyEnv}` : "环境变量";
};
