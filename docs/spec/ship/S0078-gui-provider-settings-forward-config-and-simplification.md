# S0078: GUI Provider Settings Forward Config And Simplification

## Goal

Keep the GUI model settings path forward-only after the S0073 provider/model profile
contract:

- user config should use the current provider/model profile shape, not the old single
  `[model]` shape;
- Provider and Model settings must present the user workflow, not internal config ids
  or generated defaults. Provider model cards are the place where users select a model
  and correct provider-reported model metadata.

The business outcome is that a user can configure real providers and choose models
without needing to understand Scorel's internal TOML schema or default model parameters.

## Scope

### 1. Forward config only

Scorel is still pre-release. Do not add compatibility recovery for deprecated
development-stage model config:

- `[model]`;
- `[models.*]`.

Those shapes should continue to fail through the schema path. Local user config should
be rewritten to the current provider/model profile structure instead of adding runtime
or GUI fallback logic.

### 2. Provider settings simplification

Provider settings should show only the user-facing provider fields:

- provider name;
- Base URL;
- API Key, either direct or environment-variable based;
- model list;
- per-model selection and advanced model parameters.

Internal fields such as provider id, provider type, provider protocol/API shape, and
provider model keys should be generated or preserved by the application and not exposed
as first-class controls. New Provider forms must not prefill development provider,
endpoint, channel, API key, or model values.

### 3. Provider-owned model selection and parameters

Provider model cards own the model lifecycle:

- a selected Provider model is the same thing as a Scorel available model;
- selected models can be unselected;
- configured models remain editable after selection;
- model display name, model id, context window, max tokens, reasoning, developer-role
  support, and image-input support can be corrected from the Provider model card;
- model configuration opens in a modal instead of expanding inline in the model grid;
- new Provider models get explicit editable defaults for context window, max tokens, and
  reasoning instead of an empty advanced panel;
- Provider/model ownership must be visible in the list without exposing generated ids.

### 4. Model settings simplification

Model settings should show model choices in user language:

- model name;
- model id;
- provider ownership when displaying existing models.

Do not show available-model ids or provider-model keys. Do not provide a second
"add available model" form on the Model page; the Model page only consumes models
selected from Provider settings and assigns work roles.

## Not In Scope

- Provider marketplace, pricing, ranking, routing policy, or fallback chains.
- OAuth or OS keychain storage.
- Changing runtime model selection semantics from S0073.
- Automatic compatibility migration for old config shapes.
- Deleting providers or models.
- Full model-generation smoke tests from the GUI. Provider and model test controls may
  use the existing real provider catalog path until a dedicated generation-test RPC is
  added.
- Exposing pi-ai compatibility switches that Scorel does not yet pass through
  `resolvePiAiModel`.
- Image generation output. pi-ai exposes image input in the current `Model.input`
  contract, but Scorel's message protocol and runtime do not yet have an image-output
  product path.

## Acceptance Criteria

- `~/.scorel/config.toml` uses the provider/model profile contract, not `[model]`.
- `list_models` surfaces deprecated `[model]` / `[models.*]` config as schema errors
  instead of compatibility recovery.
- Provider settings do not render provider id, provider type, provider model key,
  or default development provider/model values.
- Provider model cards render user-facing configuration for model name, model id,
  context window, max tokens, reasoning, developer-role support, and image-input
  support.
- Image-input support persists through config and maps to pi-ai `Model.input`.
- Provider model configuration appears in a modal; opening one model does not change the
  height of adjacent model cards.
- Provider settings autosave on field blur. Model configuration autosaves on field blur
  or checkbox changes. The main Provider page does not render a separate Save Provider
  or Test Provider button.
- Model test controls live next to each model's select/config controls. Passing tests
  show a green check state; failing tests show a red cross state and a readable message
  above the model list.
- A selected Provider model can be unselected, and config rendering removes the
  corresponding available model without leaving invalid role references.
- Model settings uses Chinese labels for the visible workflow.
- Existing provider/model ownership remains visible in a readable form.
- GUI-created provider models do not write hidden context-window, max-token, or
  reasoning defaults unless the user enters them in the model configuration.
- The Model page does not render "模型来源" or "加入可用模型"; it only assigns roles
  from already selected models.
- The sidebar "New chat" action returns to the initial composer for the current or
  fallback project and does not create a session until the user sends the first message.

## Test Requirements

- Core config test covers custom provider models without generated runtime metadata.
- Daemon embedded test covers `list_models` surfacing old `[model]` as a schema error.
- GUI renderer test covers simplified Provider and Model settings labels and hidden
  internal fields.
- Core config test covers Provider model metadata updates and available-model removal.
- Run:
  - `pnpm --filter @scorel/core test -- config.test.ts -t "without generated runtime metadata"`
  - `pnpm --filter @scorel/daemon test -- embedded.test.ts -t "deprecated single model config"`
  - `pnpm --filter @scorel/app-gui test -- gui-shell.test.tsx`
  - `pnpm --filter @scorel/app-gui typecheck`
  - `pnpm typecheck && pnpm test`

## Impacted Files

- `packages/core/src/config/index.ts`
- `packages/daemon/src/index.ts`
- `packages/daemon/src/embedded/embedded.test.ts`
- `apps/gui/src/renderer/settings/sections/ModelSection.tsx`
- `apps/gui/src/renderer/settings/sections/ProviderSection.tsx`
- `apps/gui/src/renderer/gui-shell.test.tsx`
- `docs/ROADMAP.md`
- `~/.scorel/config.toml`

## Risks And Boundaries

- Hiding advanced runtime metadata means coding tool budgets fall back to existing
  internal defaults when the provider model does not specify a context window. That is
  acceptable for the main Settings flow; if those values need user control, add a later
  advanced settings spec instead of leaking them into the basic provider form.
- Do not add deprecated aliases, old-shape migration, or GUI fallback logic while Scorel
  is still in forward-only pre-release development.
