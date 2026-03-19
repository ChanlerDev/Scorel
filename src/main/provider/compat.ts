import type { ProviderCompat } from "../../shared/types.js";

export const DEFAULT_COMPAT: Required<ProviderCompat> = {
  supportsDeveloperRole: false,
  maxTokensField: "max_tokens",
  requiresToolResultName: false,
  requiresAssistantAfterToolResult: false,
  requiresThinkingAsText: false,
};

export function resolveCompat(compat?: ProviderCompat): Required<ProviderCompat> {
  return { ...DEFAULT_COMPAT, ...compat };
}
