import type { Api, ProviderConfig } from "@shared/types";

export type WizardProviderType = "openai" | "anthropic" | "custom";

export type ProviderPreset = {
  id: WizardProviderType;
  displayName: string;
  api: Api;
  baseUrl: string;
  auth: { type: "bearer" | "x-api-key" };
  defaultModel: string;
  placeholder: string;
  allowsCustomBaseUrl: boolean;
};

export type ProviderDraft = {
  displayName: string;
  baseUrl: string;
  modelId: string;
  apiKey: string;
};

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: "openai",
    displayName: "OpenAI",
    api: "openai-chat-completions",
    baseUrl: "https://api.openai.com/v1",
    auth: { type: "bearer" },
    defaultModel: "gpt-4o",
    placeholder: "sk-...",
    allowsCustomBaseUrl: false,
  },
  {
    id: "anthropic",
    displayName: "Anthropic",
    api: "anthropic-messages",
    baseUrl: "https://api.anthropic.com/v1",
    auth: { type: "x-api-key" },
    defaultModel: "claude-sonnet-4-20250514",
    placeholder: "sk-ant-...",
    allowsCustomBaseUrl: false,
  },
  {
    id: "custom",
    displayName: "Custom",
    api: "openai-chat-completions",
    baseUrl: "https://api.openai.com/v1",
    auth: { type: "bearer" },
    defaultModel: "gpt-4o",
    placeholder: "sk-...",
    allowsCustomBaseUrl: true,
  },
];

export function getProviderPreset(providerType: WizardProviderType): ProviderPreset | undefined {
  return PROVIDER_PRESETS.find((preset) => preset.id === providerType);
}

export function createProviderId(displayName: string): string {
  const normalized = displayName.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized || "provider";
}

export function validateProviderDraft(
  draft: ProviderDraft,
  opts?: { requireApiKey?: boolean },
): string[] {
  const errors: string[] = [];
  const requireApiKey = opts?.requireApiKey ?? true;

  if (!draft.displayName.trim()) {
    errors.push("Display name is required");
  }
  if (!draft.baseUrl.trim()) {
    errors.push("Base URL is required");
  }
  if (!draft.modelId.trim()) {
    errors.push("Model is required");
  }
  if (requireApiKey && !draft.apiKey.trim()) {
    errors.push("API key is required");
  }

  return errors;
}

export function buildProviderConfig(input: {
  providerType: WizardProviderType;
  displayName: string;
  baseUrl: string;
  modelId: string;
}): ProviderConfig {
  const preset = getProviderPreset(input.providerType);
  if (!preset) {
    throw new Error(`Unknown provider preset: ${input.providerType}`);
  }

  const providerId = createProviderId(input.displayName);
  return {
    id: providerId,
    displayName: input.displayName.trim(),
    api: preset.api,
    baseUrl: input.baseUrl.trim().replace(/\/$/, ""),
    auth: {
      type: preset.auth.type,
      keyRef: providerId,
    },
    models: [{ id: input.modelId.trim(), displayName: input.modelId.trim() }],
  };
}
