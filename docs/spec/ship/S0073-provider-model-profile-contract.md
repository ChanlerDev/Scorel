# S0073: Provider Model Profile Contract

## Goal

Turn Scorel's current single configured model into a real provider/model profile
contract that GUI, Host runtime, CLI, and future subagents can share:

- keep pi-ai as the lower provider/model abstraction;
- let users configure pi-ai built-in providers and custom compatible endpoints;
- expose a curated available-model pool instead of every provider catalog entry;
- assign three role aliases from that pool: `primary`, `standard`, and `auxiliary`;
- use the selected model's real metadata for runtime execution, session metadata, and
  context-window-sensitive tools;
- make GUI Settings and composer model selection reflect implemented product paths.

The business outcome is simple: Scorel stops pretending there is only one model, but
does not jump into a full provider marketplace or routing policy engine.

## Scope

### 1. Config contract

Update `docs/spec/extensions.md` and the runtime config schema from one `[model]`
section to a model profile contract.

The new shape must support:

- provider definitions:
  - pi-ai built-in provider entries;
  - custom compatible endpoint entries with explicit API shape;
- provider model entries under those providers:
  - stable `id`;
  - provider reference;
  - pi-ai model id;
  - display name;
  - optional role suitability metadata only when it is needed by UI;
  - required metadata for custom models: `contextWindow`, `maxTokens`, `reasoning`,
    and compatibility flags where needed;
- available model entries:
  - stable available-model id;
  - reference to one provider model;
  - optional display override;
- role assignments:
  - `primary`;
  - `standard`;
  - `auxiliary`.

The schema must reject unknown sections/keys through the shared schema path. Do not add
ad hoc special cases for one invalid key.

Backward compatibility with the old single `[model]` config or intermediate
`[models.*]` config is not required. Scorel is pre-1.0, has no production config
inventory to preserve, and `docs/SHIP.md` allows explicit config breaks when the
current spec says so.

### 2. Provider/model resolution

Keep provider execution under `packages/core/src/provider/pi-ai.ts`.

Add a resolver that can:

- list the configured available model summaries;
- resolve a model by available-model id;
- resolve a model by role alias;
- create the correct pi-ai `Model<Api>` for both built-in and custom entries;
- return the model's `contextWindow` for tool budgets.

Scorel must not reimplement provider request protocols. It should continue to pass the
resolved pi-ai model and API key to pi-ai.

### 3. Host/runtime selection

Host runtime must use the selected model for each session/turn:

- default new sessions use `standard` unless the caller explicitly chooses another
  available model or role;
- CLI can continue using the default role without exposing a new command flag in this
  spec;
- GUI composer can choose an available model for new prompts/sessions;
- session metadata records the selected model id and role when known;
- session header persists enough selected-model metadata to keep resume auditable if
  config later changes;
- assistant events keep recording actual provider/model metadata from pi-ai.

Tool creation must use the actual selected model's context window, not a global model
from startup config.

### 4. Protocol/client surface

Expose a Host API that lets clients inspect provider connections, provider models, the
available model pool, and role assignment.

The response must be display-safe:

- no API keys;
- no raw provider payloads;
- no Relay-visible credentials;
- enough provider connection metadata for UI labels, role badges, and disabled/error
  states;
- `apiKeyEnv` is allowed in display responses, but raw `apiKey` values are not;
- missing provider env vars are reported as credential status, not as `list_models`
  failures;
- if the target Project has no model profile config yet, `list_models` returns an empty
  model list instead of surfacing config-not-found as a user-facing error.

Expose a Host API for adding/updating a Project's provider/model profile. GUI must use
this Host-owned path for both local and Relay Projects; renderer code must not write
`.scorel/config.toml` directly.

Saving a provider/model profile is a config edit, not a provider call. It must validate
shape and merge into the existing Project config, but it must not require the target
Host process to already have the provider API key env var set. Missing credentials
should block runtime use, not saving.

### 5. GUI surface

Settings separates model management from connection management:

- `模型`: provider/model profile and available models;
- `连接`: Relay pair/refresh and remote devices.

The Model settings page must support adding a provider/model profile:

- show configured provider connections as source entries;
- show provider models under the configured provider connections;
- show available models / use pool separately from provider models;
- show role assignments for `primary`, `standard`, and `auxiliary`;
- add or update a provider connection;
- add or update provider models under a provider connection;
- add a provider model into available models before it can be used by composer, main
  agent, or future subagents;
- support one provider connection with multiple configured models without overwriting
  previously-added models;
- show missing credential status clearly without treating it as a save failure;
- show invalid model/profile errors clearly.

Composer gets a real model picker:

- it lists available models from the connected Host;
- selecting a model affects the current new session / next prompt path according to the
  runtime contract;
- it must not list arbitrary provider catalog entries that are not in available models.

The UI should use generic role language, not Anthropic-specific names such as Opus,
Sonnet, or Haiku.

### 6. Subagent contract only

This spec defines the model-selection contract future subagents must use:

- default subagent selection is role-based (`primary`, `standard`, `auxiliary`);
- explicit subagent model override, when added later, must point to an available model id;
- subagents must not bypass the available-model pool.

This spec does not implement a new subagent execution engine.

## Not In Scope

- OAuth or browser-based provider login.
- Provider marketplace, pricing comparison, latency benchmarking, automatic model ranking,
  fallback chains, or policy-based routing.
- Dynamic remote catalog sync for every provider. Built-in pi-ai catalog and configured
  custom model entries are enough for V1.
- Storing raw API keys in GUI state or config. GUI only stores `apiKeyEnv`; users set
  the environment variable on the target Host.
- Full subagent orchestration.
- Per-tool model routing.
- Per-message hidden model switching not visible in session metadata.
- Relay storage of provider credentials, prompt text, provider payloads, or model routing
  internals.

## Acceptance Criteria

- `docs/spec/extensions.md` documents the new provider/model profile config and clearly
  states that old single `[model]` config is replaced.
- Config tests cover:
  - one built-in provider with three available role assignments;
  - one custom compatible endpoint with manual metadata;
  - rejecting unknown model/profile keys;
  - rejecting a role that points outside the available model pool;
  - rejecting a missing provider credential env var.
- Core/provider tests cover:
  - resolving a built-in available model through pi-ai;
  - resolving a custom available model;
  - resolving role aliases to available models;
  - using the selected model's context window.
- Daemon/client tests cover:
  - model profile summary is exposed without API keys;
  - a Project with no model config returns an empty model profile summary;
  - adding/updating a provider/model profile writes a valid `.scorel/config.toml`
    without requiring API key env vars;
  - adding a second model under the same provider preserves the existing provider and
    model entries;
  - new sessions default to `standard`;
  - explicit selected model id and resolved display metadata are persisted in session
    metadata;
  - resumed sessions use the persisted selected model rather than silently switching
    because current config changed;
  - runtime uses the selected model when creating the provider and coding tools.
- GUI tests cover:
  - Settings renders separate `模型` and `连接` pages;
  - Model settings supports adding a provider/model profile;
  - composer renders a real model picker, not a disabled placeholder;
  - picker options are limited to available models;
  - role labels are generic (`primary`, `standard`, `auxiliary`) and not hard-coded to
    Anthropic names.
- Run:
  - `pnpm --filter @scorel/core test`
  - `pnpm --filter @scorel/daemon test`
  - `pnpm --filter @scorel/app-gui typecheck`
  - `pnpm --filter @scorel/app-gui test`
  - `pnpm typecheck && pnpm test`
- Run one real-provider product smoke with a real configured model profile. Mock/fake
  provider is not accepted as completion proof for the product path.

## Impacted Files

- `docs/spec/extensions.md`
- `docs/ROADMAP.md`
- `packages/core/src/config/index.ts`
- `packages/core/src/config/config.test.ts`
- `packages/core/src/provider/pi-ai.ts`
- `packages/core/src/provider/pi-ai.test.ts`
- `packages/core/src/tools/coding-tools.ts`
- `packages/daemon/src/index.ts`
- daemon tests under `packages/daemon/src/`
- protocol/client types under `packages/protocol/src/` and `packages/client/src/` if the
  Host API needs new messages
- GUI renderer and tests under `apps/gui/src/renderer/`

## Risks And Boundaries

- pi-ai built-in catalog metadata is local package data; provider-side model availability
  can drift. Runtime errors must clearly say which configured provider/model failed.
- Custom endpoints may not expose reliable model catalogs. V1 should require explicit
  custom model metadata instead of guessing.
- Changing default role assignments must not rewrite historical session events.
- Larger context windows directly affect Read output budgets. Tests must prove the
  selected model drives the budget.
- A broad "login provider" abstraction would be misleading for API-key custom endpoints.
  Use "provider connection" or "provider config" unless real OAuth/login is implemented.
