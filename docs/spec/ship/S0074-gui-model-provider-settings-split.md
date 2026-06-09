# S0074: GUI Model And Provider Settings Split

## Goal

Make GUI Settings model configuration match the user workflow:

1. choose the three working models Scorel actually uses;
2. maintain the curated available-model pool;
3. manage LLM provider connections and provider-level models separately.

The business outcome is that users can understand where a model comes from, whether it
is allowed for Scorel use, and which model powers each agent role without reading TOML.

## Scope

### 1. Settings navigation

Split the current model/provider combined page into three settings pages:

- `模型`: working model role assignment and available models;
- `Provider`: LLM provider connections and provider model/source management;
- `连接`: Relay pairing and remote device connection management.

`Provider` is intentionally separate from `连接`: LLM providers are model suppliers,
while `连接` is about remote Scorel devices and Relay.

### 2. Model page

The `模型` page must show:

- a top section for choosing `Primary`, `Standard`, and `Auxiliary` from available
  models only;
- an available models section showing alias, display name, source provider model,
  provider/model id, and current role usage;
- controls to add a provider model into available models.

The page must not expose provider connection fields such as `baseUrl`, `apiKeyEnv`, or
provider protocol controls.

### 3. Provider page

The `Provider` page must show:

- a left provider list;
- a right scrollable provider details panel with `providerId`, provider type, protocol
  / API shape, `baseUrl`, and `apiKeyEnv`;
- the provider's models below the provider details, with an action to stage/add a model
  into available models;
- manual provider model entry for V1.

V1 can display configured provider models as the provider model source list. Real remote
catalog sync from provider `/v1/models` is not part of this spec, but the UI should be
shaped so that future catalog data can replace the configured list without changing the
page hierarchy.

### 4. Existing Host contract

Continue using the Host-owned `list_models` and `upsert_model_profile` path. Renderer
code must not write `.scorel/config.toml` directly.

This spec can reuse the S0073 data model and does not need a new protocol message unless
the UI needs one for clean implementation.

## Not In Scope

- Fetching provider `/v1/models` catalogs.
- OAuth/browser provider login.
- Storing raw API keys.
- Pricing, benchmarking, automatic model ranking, routing policy, or fallback chains.
- Changing runtime model selection semantics from S0073.
- Renaming `primary`, `standard`, or `auxiliary`.

## Acceptance Criteria

- Settings nav shows separate `模型`, `Provider`, and `连接` pages.
- `模型` page renders working model role selectors before available models.
- `模型` page does not render provider connection fields.
- `Provider` page renders a provider list and a scrollable provider details area.
- `Provider` page exposes provider fields and provider models/source list.
- Available models can still be added from a provider model through the Host upsert path.
- Missing credentials remain status-only in Settings and do not block saving config.
- A project with no model config still renders empty model/provider settings without
  throwing.

## Test Requirements

- GUI rendering tests cover the three settings nav entries.
- GUI rendering tests assert `模型` and `Provider` content are separated.
- Existing daemon/config tests for S0073 must continue to pass.
- Run:
  - `pnpm --filter @scorel/app-gui test`
  - `pnpm --filter @scorel/app-gui build`
  - `pnpm typecheck`
  - `pnpm test`

## Impacted Files

- `docs/spec/ship/S0074-gui-model-provider-settings-split.md`
- `docs/ROADMAP.md`
- `apps/gui/src/renderer/settings/SettingsShell.tsx`
- `apps/gui/src/renderer/settings/sections/ModelSection.tsx`
- new provider settings section under `apps/gui/src/renderer/settings/sections/`
- `apps/gui/src/renderer/styles.css`
- GUI renderer tests under `apps/gui/src/renderer/`

## Risks And Boundaries

- Splitting pages must not duplicate divergent save logic. Both pages should continue
  using the same Host profile upsert API.
- Provider model source list can be mistaken for live catalog sync. V1 copy must be
  clear that it is the configured provider models list until remote catalog sync exists.
- `Provider` must not be folded into `连接`, or users will confuse LLM suppliers with
  Relay/remote device connectivity.
