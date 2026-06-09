# S0075: Provider Catalog Model Cards

## Goal

Make the GUI Provider settings page usable for real provider setup:

- "新建 provider" must visibly reset the details panel for a new provider;
- provider models should be shown as selectable model cards, not a table plus an
  always-expanded form;
- the Provider page should fetch models from the provider `/models` endpoint from the
  Host side, then let users choose which fetched models become available models.

## Scope

### 1. Host catalog API

Add a Host-owned request that fetches a provider's model catalog for a Project:

- input: `projectId`, `providerId`;
- output: a display-safe list of catalog models with `id` and `displayName`;
- renderer never reads raw API keys;
- missing credentials return a user-facing error;
- custom OpenAI-compatible providers use `GET {baseUrl}/models` with bearer auth.

For V1, only OpenAI-compatible `/models` catalog fetch is required. Built-in pi-ai
catalog and non-OpenAI protocols can be handled by later specs.

### 2. Provider page interaction

Update `Provider` settings:

- right top header has a `获取模型` button;
- provider model source list is rendered as compact cards/blocks;
- cards are collapsed by default;
- clicking a card expands its model config details;
- each card has a button state representing whether the model is selected into
  available models (`选用` / `已选用`);
- manual add remains available for users to add a model not returned by `/models`;
- clicking `新建 provider` clears/selects a new-provider editing state instead of
  appearing to do nothing.

## Not In Scope

- Full provider catalog sync persistence or background refresh.
- Pricing, latency, model ranking, routing policy, or fallback chains.
- OAuth/browser login.
- API key storage.
- Dynamic metadata discovery for `contextWindow`, `maxTokens`, or reasoning support.

## Acceptance Criteria

- GUI shows a `获取模型` button on the Provider page.
- Clicking `新建 provider` changes the details panel to a new provider draft.
- Provider model entries render as collapsed cards by default.
- Clicking a model card expands details/config controls.
- Model card action shows `选用` when not in available models and `已选用` when already
  selected.
- Host catalog fetch uses `/models` for custom OpenAI-compatible providers.
- Renderer uses IPC/client API for catalog fetch and never reads provider API keys.

## Test Requirements

- Protocol/client tests cover the new catalog fetch request shape.
- Daemon test covers fetching from a real local HTTP `/models` endpoint.
- GUI rendering test covers `获取模型`, collapsed model cards, and selected state text.
- Run:
  - `pnpm --filter @scorel/daemon test`
  - `pnpm --filter @scorel/app-gui test`
  - `pnpm --filter @scorel/app-gui build`
  - `pnpm typecheck`
  - `pnpm test`

## Impacted Files

- `docs/spec/ship/S0075-provider-catalog-model-cards.md`
- `docs/ROADMAP.md`
- `packages/protocol/src/events.ts`
- `packages/protocol/src/wire.ts`
- `packages/client/src/index.ts`
- `packages/daemon/src/index.ts`
- `apps/gui/src/shared/ipc.ts`
- `apps/gui/src/main.ts`
- `apps/gui/src/main/local-host.ts`
- `apps/gui/src/main/relay-service.ts`
- `apps/gui/src/renderer/settings/sections/ProviderSection.tsx`
- `apps/gui/src/renderer/styles.css`

## Risks And Boundaries

- `/models` responses often lack context window and max token metadata. Users may still
  need to expand a card and fill metadata before saving custom provider models.
- Some providers do not implement OpenAI-compatible `/models`; V1 should fail clearly
  instead of pretending every protocol has a shared catalog endpoint.
