import { useMemo, useState } from "react";

import type { GuiModelProfileView, GuiProjectRef, GuiProviderCatalogModelView, GuiUpsertModelProfileInput } from "../../../shared/ipc.js";
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
  contextWindow: number;
  maxTokens: number;
  reasoning: boolean;
};

type ProviderModelCard = {
  providerModelKey: string;
  id: string;
  displayName: string;
  contextWindow?: number;
  maxTokens?: number;
  reasoning?: boolean;
  configured: boolean;
  selected: boolean;
};

const DEFAULT_PROVIDER_FORM: ProviderForm = {
  providerId: "chanleramp",
  providerType: "custom",
  provider: "chanleramp",
  api: "openai-completions",
  baseUrl: "https://amp.chanler.dev/v1",
  credentialMode: "env",
  apiKeyEnv: "SCOREL_API_KEY",
  apiKey: "",
};

const DEFAULT_PROVIDER_MODEL_FORM: ProviderModelForm = {
  providerId: "chanleramp",
  providerModelKey: "chanleramp_deepseek_flash",
  providerModelId: "deepseek-v4-flash",
  displayName: "DeepSeek Flash",
  contextWindow: 128000,
  maxTokens: 32000,
  reasoning: false,
};

export function ProviderSection({
  project,
  modelProfile,
  busy,
  setBusy,
  setError,
  onModelProfileChange,
}: ProviderSectionProps) {
  const [providerForm, setProviderForm] = useState<ProviderForm>(DEFAULT_PROVIDER_FORM);
  const [providerModelForm, setProviderModelForm] = useState<ProviderModelForm>(DEFAULT_PROVIDER_MODEL_FORM);
  const [selectedProviderId, setSelectedProviderId] = useState(DEFAULT_PROVIDER_FORM.providerId);
  const [catalogModels, setCatalogModels] = useState<GuiProviderCatalogModelView[]>([]);
  const [catalogQuery, setCatalogQuery] = useState("");
  const [expandedModelId, setExpandedModelId] = useState<string | null>(null);
  const [newProviderForm, setNewProviderForm] = useState<ProviderForm>(newProviderDraft());
  const [newProviderModalOpen, setNewProviderModalOpen] = useState(false);

  const providerById = useMemo(
    () => new Map(modelProfile.providers.map((provider) => [provider.providerId, provider])),
    [modelProfile.providers],
  );
  const selectedProvider = selectedProviderId ? providerById.get(selectedProviderId) ?? modelProfile.providers[0] : undefined;
  const selectedProviderModels = modelProfile.providerModels.filter((model) => model.providerId === selectedProvider?.providerId);
  const availableProviderModelIds = new Set(modelProfile.models.map((model) => model.providerModelId));
  const modelCards: ProviderModelCard[] = [
    ...selectedProviderModels.map((model) => ({
      providerModelKey: model.providerModelId,
      id: model.id,
      displayName: model.displayName,
      contextWindow: model.contextWindow,
      maxTokens: model.maxTokens,
      reasoning: model.reasoning,
      configured: true,
      selected: availableProviderModelIds.has(model.providerModelId),
    })),
    ...catalogModels
      .filter((model) => !selectedProviderModels.some((configured) => configured.id === model.id))
      .map((model) => ({
        providerModelKey: `${selectedProvider?.providerId ?? providerForm.providerId}_${identifierFromModelId(model.id)}`,
        id: model.id,
        displayName: model.displayName,
        configured: false,
        selected: false,
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
    setExpandedModelId(null);
    setProviderModelForm((current) => ({ ...current, providerId }));
    if (!provider) return;
    setProviderForm({
      providerId: provider.providerId,
      providerType: provider.type,
      provider: providerName(provider.provider),
      api: provider.api ?? "openai-completions",
      baseUrl: provider.baseUrl ?? "",
      credentialMode: provider.credentialSource,
      apiKeyEnv: provider.apiKeyEnv ?? "",
      apiKey: "",
    });
  };

  const newProvider = (): void => {
    setNewProviderForm(newProviderDraft());
    setNewProviderModalOpen(true);
  };

  const saveProvider = (form: ProviderForm): Promise<void> =>
    save(providerInput(form));

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
      setExpandedModelId(null);
      setNewProviderModalOpen(false);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const saveProviderModel = (): Promise<void> =>
    save({
      providerId: providerModelForm.providerId,
      providerModelKey: providerModelForm.providerModelKey,
      providerModelId: providerModelForm.providerModelId,
      displayName: providerModelForm.displayName,
      ...(selectedProvider?.type === "custom" || !selectedProvider
        ? {
            contextWindow: providerModelForm.contextWindow,
            maxTokens: providerModelForm.maxTokens,
            reasoning: providerModelForm.reasoning,
          }
        : {}),
    });

  const saveProviderModelToAvailable = (model: {
    providerModelKey: string;
    id: string;
    displayName: string;
    contextWindow?: number;
    maxTokens?: number;
    reasoning?: boolean;
  }): Promise<void> => {
    const providerModelKey = expandedModelId === model.providerModelKey ? providerModelForm.providerModelKey : model.providerModelKey;
    const providerModelId = expandedModelId === model.providerModelKey ? providerModelForm.providerModelId : model.id;
    const displayName = expandedModelId === model.providerModelKey ? providerModelForm.displayName || model.displayName : model.displayName;
    const contextWindow = expandedModelId === model.providerModelKey ? providerModelForm.contextWindow : model.contextWindow ?? DEFAULT_PROVIDER_MODEL_FORM.contextWindow;
    const maxTokens = expandedModelId === model.providerModelKey ? providerModelForm.maxTokens : model.maxTokens ?? DEFAULT_PROVIDER_MODEL_FORM.maxTokens;
    const reasoning = expandedModelId === model.providerModelKey ? providerModelForm.reasoning : model.reasoning ?? false;
    return save({
      providerId: selectedProvider?.providerId ?? providerForm.providerId,
      providerModelKey,
      providerModelId,
      displayName,
      ...(selectedProvider?.type === "custom" || providerForm.providerType === "custom"
        ? { contextWindow, maxTokens, reasoning }
        : {}),
      availableModelId: identifierFromModelId(providerModelId),
      addToAvailable: true,
    });
  };

  const fetchProviderModels = async (): Promise<void> => {
    if (!project || !selectedProvider) return;
    setBusy(true);
    try {
      const models = await window.scorel.fetchProviderModels(project, selectedProvider.providerId);
      setCatalogModels(models);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const expandModel = (model: { providerModelKey: string; id: string; displayName: string; contextWindow?: number; maxTokens?: number; reasoning?: boolean }): void => {
    if (expandedModelId === model.providerModelKey) {
      setExpandedModelId(null);
      return;
    }
    setExpandedModelId(model.providerModelKey);
    setProviderModelForm({
      providerId: selectedProvider?.providerId ?? providerForm.providerId,
      providerModelKey: model.providerModelKey,
      providerModelId: model.id,
      displayName: model.displayName,
      contextWindow: model.contextWindow ?? DEFAULT_PROVIDER_MODEL_FORM.contextWindow,
      maxTokens: model.maxTokens ?? DEFAULT_PROVIDER_MODEL_FORM.maxTokens,
      reasoning: model.reasoning ?? false,
    });
  };

  return (
    <>
      <SettingsHeader
        title="Provider"
        subtitle="管理 LLM provider 连接、协议和 provider 下的模型来源。"
      />

      {modelProfile.warnings?.map((warning) => (
        <section className="settings-section settings-section--wide" key={warning}>
          <SettingsCard>
            <div className="settings-empty">{warning}</div>
          </SettingsCard>
        </section>
      ))}

      <section className="settings-section settings-section--wide">
        <h2 className="settings-section__title">Provider Management</h2>
        <SettingsCard>
          <div className="provider-management">
            <aside className="provider-list" aria-label="Provider list">
              {modelProfile.providers.length === 0 ? (
                <div className="settings-empty">还没有 provider。</div>
              ) : (
                modelProfile.providers.map((provider) => (
                  <button
                    type="button"
                    className={provider.providerId === selectedProvider?.providerId ? "provider-list__item provider-list__item--active" : "provider-list__item"}
                    key={provider.providerId}
                    onClick={() => selectProvider(provider.providerId)}
                  >
                    <span>{provider.providerId}</span>
                    <small>{providerName(provider.provider)} / {provider.credentialStatus === "available" ? `${provider.credentialSource} ready` : "missing key"}</small>
                  </button>
                ))
              )}
              <button type="button" className="button provider-list__add" onClick={newProvider}>
                新建 provider
              </button>
            </aside>

            <div className="provider-detail">
              <div className="provider-detail__scroll">
                <div className="settings-form settings-form--compact">
                  <label>
                    <span>Provider id</span>
                    <input className="input-text" value={providerForm.providerId} onChange={(event) => setProviderForm({ ...providerForm, providerId: event.currentTarget.value })} />
                  </label>
                  <label>
                    <span>Provider type</span>
                    <select className="input-text" value={providerForm.providerType} onChange={(event) => setProviderForm({ ...providerForm, providerType: event.currentTarget.value as ProviderForm["providerType"] })}>
                      <option value="custom">Custom endpoint</option>
                      <option value="builtin">pi-ai builtin</option>
                    </select>
                  </label>
                  <label>
                    <span>Provider</span>
                    <input className="input-text" value={providerForm.provider} onChange={(event) => setProviderForm({ ...providerForm, provider: event.currentTarget.value })} onBlur={() => setProviderForm({ ...providerForm, provider: providerName(providerForm.provider) })} />
                  </label>
                  <label>
                    <span>Credential</span>
                    <select className="input-text" value={providerForm.credentialMode} onChange={(event) => setProviderForm({ ...providerForm, credentialMode: event.currentTarget.value as ProviderForm["credentialMode"] })}>
                      <option value="env">Env key</option>
                      <option value="direct">Direct API key</option>
                    </select>
                  </label>
                  {providerForm.credentialMode === "env" ? (
                    <label>
                      <span>API key env</span>
                      <input className="input-text" value={providerForm.apiKeyEnv} onChange={(event) => setProviderForm({ ...providerForm, apiKeyEnv: event.currentTarget.value })} />
                    </label>
                  ) : (
                    <label>
                      <span>API key</span>
                      <input className="input-text" type="password" placeholder="已配置则留空保留" value={providerForm.apiKey} onChange={(event) => setProviderForm({ ...providerForm, apiKey: event.currentTarget.value })} />
                    </label>
                  )}
                  {providerForm.providerType === "custom" ? (
                    <>
                      <label>
                        <span>API</span>
                        <select className="input-text" value={providerForm.api} onChange={(event) => setProviderForm({ ...providerForm, api: event.currentTarget.value as ProviderForm["api"] })}>
                          <option value="openai-completions">openai-completions</option>
                          <option value="openai-responses">openai-responses</option>
                          <option value="google-generative-ai">google-generative-ai</option>
                          <option value="anthropic-messages">anthropic-messages</option>
                        </select>
                      </label>
                      <label>
                        <span>Base URL</span>
                        <input className="input-text" value={providerForm.baseUrl} onChange={(event) => setProviderForm({ ...providerForm, baseUrl: event.currentTarget.value })} />
                      </label>
                    </>
                  ) : null}
                  <button type="button" className="button button--primary" disabled={busy || !project} onClick={() => void saveProvider(providerForm)}>
                    保存 provider
                  </button>
                </div>

                <div className="provider-catalog">
                  <div className="settings-card__head">
                    <span className="settings-section__title">Models from provider</span>
                    <div className="settings-card__head-meta">
                      <input className="input-text provider-catalog__search" placeholder="搜索 models" value={catalogQuery} onChange={(event) => setCatalogQuery(event.currentTarget.value)} />
                      <span className="settings-value">{filteredModelCards.length}/{modelCards.length} models</span>
                      <button type="button" className="button" disabled={busy || !project || !selectedProvider} onClick={() => void fetchProviderModels()}>
                        获取模型
                      </button>
                    </div>
                  </div>
                  {modelCards.length === 0 ? (
                    <div className="settings-empty">点击右上角获取模型走 provider /models，也可以在下方手动添加 model。</div>
                  ) : filteredModelCards.length === 0 ? (
                    <div className="settings-empty">没有匹配的 model。</div>
                  ) : (
                    <div className="provider-model-card-list">
                      {filteredModelCards.map((model) => {
                        const expanded = expandedModelId === model.providerModelKey;
                        return (
                          <div className="provider-model-card" key={model.providerModelKey}>
                            <button type="button" className="provider-model-card__summary" onClick={() => expandModel(model)}>
                              <span>
                                <strong>{model.displayName}</strong>
                                <small>{model.providerModelKey} / {model.id}</small>
                              </span>
                              <span className="provider-model-card__meta">
                                {model.contextWindow ? `${model.contextWindow.toLocaleString()} ctx` : model.configured ? "已登记" : "catalog"}
                              </span>
                            </button>
                            {expanded ? (
                              <div className="provider-model-card__details">
                                <label>
                                  <span>Provider model key</span>
                                  <input className="input-text" value={providerModelForm.providerModelKey} onChange={(event) => setProviderModelForm({ ...providerModelForm, providerModelKey: event.currentTarget.value })} />
                                </label>
                                <label>
                                  <span>Provider model id</span>
                                  <input className="input-text" value={providerModelForm.providerModelId} onChange={(event) => setProviderModelForm({ ...providerModelForm, providerModelId: event.currentTarget.value })} />
                                </label>
                                <label>
                                  <span>Display name</span>
                                  <input className="input-text" value={providerModelForm.displayName} onChange={(event) => setProviderModelForm({ ...providerModelForm, displayName: event.currentTarget.value })} />
                                </label>
                                {selectedProvider?.type !== "builtin" ? (
                                  <>
                                    <label>
                                      <span>Context window</span>
                                      <input className="input-text" type="number" value={providerModelForm.contextWindow} onChange={(event) => setProviderModelForm({ ...providerModelForm, contextWindow: Number(event.currentTarget.value) })} />
                                    </label>
                                    <label>
                                      <span>Max tokens</span>
                                      <input className="input-text" type="number" value={providerModelForm.maxTokens} onChange={(event) => setProviderModelForm({ ...providerModelForm, maxTokens: Number(event.currentTarget.value) })} />
                                    </label>
                                  </>
                                ) : null}
                              </div>
                            ) : null}
                            <div className="provider-model-card__actions">
                              <button type="button" className={model.selected ? "button button--selected" : "button"} disabled={busy || !project || model.selected} onClick={() => void saveProviderModelToAvailable(model)}>
                                {model.selected ? "已选用" : "选用"}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  <details className="provider-manual-model">
                    <summary>自行添加 model</summary>
                    <div className="settings-form settings-form--compact">
                    <label>
                      <span>Provider model key</span>
                      <input className="input-text" value={providerModelForm.providerModelKey} onChange={(event) => setProviderModelForm({ ...providerModelForm, providerModelKey: event.currentTarget.value })} />
                    </label>
                    <label>
                      <span>Provider model id</span>
                      <input className="input-text" value={providerModelForm.providerModelId} onChange={(event) => setProviderModelForm({ ...providerModelForm, providerModelId: event.currentTarget.value })} />
                    </label>
                    <label>
                      <span>Display name</span>
                      <input className="input-text" value={providerModelForm.displayName} onChange={(event) => setProviderModelForm({ ...providerModelForm, displayName: event.currentTarget.value })} />
                    </label>
                    {selectedProvider?.type !== "builtin" ? (
                      <>
                        <label>
                          <span>Context window</span>
                          <input className="input-text" type="number" value={providerModelForm.contextWindow} onChange={(event) => setProviderModelForm({ ...providerModelForm, contextWindow: Number(event.currentTarget.value) })} />
                        </label>
                        <label>
                          <span>Max tokens</span>
                          <input className="input-text" type="number" value={providerModelForm.maxTokens} onChange={(event) => setProviderModelForm({ ...providerModelForm, maxTokens: Number(event.currentTarget.value) })} />
                        </label>
                      </>
                    ) : null}
                    <button type="button" className="button button--primary" disabled={busy || !project} onClick={() => void saveProviderModel()}>
                      保存 provider model
                    </button>
                    </div>
                  </details>
                </div>
              </div>
            </div>
          </div>
        </SettingsCard>
      </section>
      {newProviderModalOpen ? (
        <div className="modal" onMouseDown={() => setNewProviderModalOpen(false)} role="dialog" aria-label="New provider">
          <div className="modal__panel provider-modal" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal__header">
              <h2 className="modal__title">新建 provider</h2>
              <button type="button" className="modal__icon-button" onClick={() => setNewProviderModalOpen(false)} aria-label="Close">x</button>
            </div>
            <p className="modal__subtitle">添加一个 LLM provider。取消不会写入配置。</p>
            <ProviderFormFields form={newProviderForm} setForm={setNewProviderForm} />
            <div className="modal__footer">
              <button type="button" className="button" onClick={() => setNewProviderModalOpen(false)}>取消</button>
              <button type="button" className="button button--primary" disabled={busy || !project} onClick={() => void saveNewProvider()}>
                保存 provider
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
        <span>Provider id</span>
        <input className="input-text" value={form.providerId} onChange={(event) => setForm({ ...form, providerId: event.currentTarget.value })} />
      </label>
      <label>
        <span>Provider type</span>
        <select className="input-text" value={form.providerType} onChange={(event) => setForm({ ...form, providerType: event.currentTarget.value as ProviderForm["providerType"] })}>
          <option value="custom">Custom endpoint</option>
          <option value="builtin">pi-ai builtin</option>
        </select>
      </label>
      <label>
        <span>Provider</span>
        <input className="input-text" value={form.provider} onChange={(event) => setForm({ ...form, provider: event.currentTarget.value })} onBlur={() => setForm({ ...form, provider: providerName(form.provider) })} />
      </label>
      <label>
        <span>Credential</span>
        <select className="input-text" value={form.credentialMode} onChange={(event) => setForm({ ...form, credentialMode: event.currentTarget.value as ProviderForm["credentialMode"] })}>
          <option value="env">Env key</option>
          <option value="direct">Direct API key</option>
        </select>
      </label>
      {form.credentialMode === "env" ? (
        <label>
          <span>API key env</span>
          <input className="input-text" value={form.apiKeyEnv} onChange={(event) => setForm({ ...form, apiKeyEnv: event.currentTarget.value })} />
        </label>
      ) : (
        <label>
          <span>API key</span>
          <input className="input-text" type="password" value={form.apiKey} onChange={(event) => setForm({ ...form, apiKey: event.currentTarget.value })} />
        </label>
      )}
      {form.providerType === "custom" ? (
        <>
          <label>
            <span>API</span>
            <select className="input-text" value={form.api} onChange={(event) => setForm({ ...form, api: event.currentTarget.value as ProviderForm["api"] })}>
              <option value="openai-completions">openai-completions</option>
              <option value="openai-responses">openai-responses</option>
              <option value="google-generative-ai">google-generative-ai</option>
              <option value="anthropic-messages">anthropic-messages</option>
            </select>
          </label>
          <label>
            <span>Base URL</span>
            <input className="input-text" value={form.baseUrl} onChange={(event) => setForm({ ...form, baseUrl: event.currentTarget.value })} />
          </label>
        </>
      ) : null}
    </div>
  );
}

const providerInput = (form: ProviderForm): GuiUpsertModelProfileInput => ({
  providerId: form.providerId,
  providerType: form.providerType,
  provider: providerName(form.provider),
  ...(form.credentialMode === "direct" ? { apiKey: form.apiKey } : { apiKeyEnv: form.apiKeyEnv }),
  ...(form.providerType === "custom" ? { api: form.api, baseUrl: form.baseUrl } : {}),
});

const newProviderDraft = (): ProviderForm => ({
  ...DEFAULT_PROVIDER_FORM,
  providerId: "new_provider",
  provider: "provider-name",
  baseUrl: "",
  credentialMode: "direct",
  apiKeyEnv: "",
  apiKey: "",
});

const providerName = (value: string): string => value.split("/")[0]?.trim() || value.trim();
const identifierFromModelId = (value: string): string => value.replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "model";
