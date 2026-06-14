# S0076: Provider Modal Search And Direct API Key

## Goal

Polish the GUI model/provider settings flow so users can configure real providers
without confusing provider names, drafts, or credential setup:

- provider display should show the LLM provider name, not a model path;
- `Models from provider` should be searchable;
- creating a provider should happen in a modal and only persist after save;
- users can paste a direct API key instead of only referencing an env var.

## Scope

### 1. Provider name display

Provider values may arrive as path-like strings during development, such as
`AMP/codex/gpt-5.3-codex-spark`. GUI model summaries should display only the
provider segment before the first `/`, while model ids keep the full model id.

When saving a provider from GUI, normalize the provider field to that first segment.

### 2. Provider catalog search

The Provider page `Models from provider` panel gets a search input that filters
configured provider models and fetched `/models` catalog cards by display name,
provider model key, or provider model id.

### 3. New provider modal

Clicking `新建 provider` opens a modal form. The provider list and detail panel do not
change until the user saves the modal. Canceling closes the modal without creating or
selecting a draft provider.

### 4. Direct API key

Provider config supports either:

- `apiKeyEnv`, resolved from environment variables; or
- `apiKey`, stored directly in the device `~/.scorel/config.toml`.

GUI never receives direct API key values when listing providers. Editing an existing
direct-key provider shows only that a direct key is configured. Saving a provider with
the API key field left blank preserves the existing direct key.

## Not In Scope

- OS keychain storage or encryption-at-rest.
- Migrating existing env-key providers to direct-key providers automatically.
- Provider delete / duplicate / reorder controls.
- Advanced catalog metadata beyond `/models` id/name.

## Acceptance Criteria

- Model settings show provider names using the segment before `/`.
- Provider page has a search input for `Models from provider`.
- `新建 provider` opens a modal; canceling it persists nothing.
- Saving a provider from the modal creates the provider and then selects it.
- Users can provide either an env var name or a direct API key.
- Provider list/status differentiates env and direct credentials without exposing raw
  direct API key values through IPC.
- `/models` fetch works with both env-key and direct-key providers.

## Test Requirements

- Config tests cover direct API key loading, redacted profile listing, and provider
  model upsert preserving existing direct keys.
- GUI rendering tests cover provider search, new provider modal trigger, direct API key
  fields, and provider display normalization.
- Typecheck and GUI build pass.
