# S0090: GUI Provider Delete And Dark Code Theme

## Goal

Fix two GUI regressions before the next IM expansion:

- dark theme code blocks must use a dark Shiki theme instead of light-token colors;
- Provider settings must expose a real delete path for configured providers.

The business value is basic settings trust. Users should be able to remove bad provider config and read code blocks in the selected GUI theme.

## Scope

### Dark Code Blocks

- Load both light and dark Shiki themes in the GUI code block highlighter.
- Select the rendered theme from `:root[data-theme]` / system dark preference.
- Re-render when the GUI theme changes.
- Keep code block chrome styled by Scorel tokens; only syntax token colors switch.

### Provider Delete

- Add a protocol/client/daemon request for removing one provider from a project model profile.
- Deleting a provider removes:
  - `[providers.<id>]`;
  - provider models owned by that provider;
  - available models pointing at removed provider models;
  - role selections that pointed at removed available models, with stable fallback when possible.
- GUI Provider Settings exposes a delete button for the selected provider.
- If no provider remains, the Provider page returns to the empty state without stale selected-provider UI.

## Not In Scope

- Deleting individual provider model definitions unless required by provider deletion.
- Bulk reset of all model profile config.
- Provider secret migration.
- Changing provider catalog fetch behavior.
- IM platform work; covered by S0091-S0093.

## Acceptance Criteria

- Dark GUI theme renders Shiki tokens with a dark theme.
- Light GUI theme keeps the current light code block behavior.
- Switching GUI theme updates future code block renders without app restart.
- Provider delete removes the provider and all dependent model profile entries from persisted config.
- Provider delete does not leave roles pointing at removed models.
- GUI can delete the selected provider and updates the selected provider to the next available provider or empty state.
- Remote GUI provider deletion uses the same daemon/client request as local GUI.

## Testing Requirements

- GUI Shiki tests prove both light and dark themes are loaded/selected.
- Config renderer tests cover provider deletion and role fallback.
- Protocol/client/daemon tests cover the delete request.
- GUI render test covers delete button and empty-state transition.
- Full `pnpm typecheck && pnpm test`.

## Impacted Files

- `apps/gui/src/renderer/chatbox/ShikiCodeBlock.tsx`
- `apps/gui/src/renderer/chatbox/ShikiCodeBlock.test.tsx`
- `apps/gui/src/shiki-theme.test.ts`
- `apps/gui/src/renderer/settings/sections/ProviderSection.tsx`
- `apps/gui/src/shared/ipc.ts`
- `apps/gui/src/main.ts`
- `apps/gui/src/main/local-host.ts`
- `apps/gui/src/main/relay-service.ts`
- `packages/protocol/src/events.ts`
- `packages/protocol/src/wire.ts`
- `packages/client/src/index.ts`
- `packages/core/src/config/index.ts`
- `packages/core/src/config/*.test.ts`
- `packages/daemon/src/index.ts`

## Status

Done.
