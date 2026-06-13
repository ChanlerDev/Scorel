# S0099: GUI Connection And Device Settings

## Goal

Make GUI connection setup match the hosted Relay product path and make remote configuration scope explicit, so users can pair devices, rename paired devices, inspect connection details, and switch settings to a remote Project without wondering whether model/provider settings are local or remote.

## Scope

- GUI Relay pairing:
  - default to the official Relay without showing an editable URL field;
  - expose Relay URL editing only behind an explicit edit affordance;
  - rename the pairing action from `Pair` to `Get Pair Code`.
- GUI paired devices:
  - allow users to rename a paired Relay Device locally in GUI state;
  - preserve the Relay-reported label as fallback when no local name exists;
  - show device details from the generic device view: status, Device ID, IP when available, and Relay URL.
- GUI Settings scope:
  - replace the disabled "此电脑" nav row with a real Project scope selector;
  - include local and remote Projects in the selector;
  - keep model/provider/memory/runtime settings bound to the selected `GuiProjectRef`, so selecting a remote Project reads and writes the remote Host environment through Relay.
- Tests and docs:
  - cover local device rename persistence;
  - cover the connection section rendering contract;
  - keep ROADMAP in sync.

## Not In Scope

- Relay protocol changes or IP discovery in Relay V1. The UI may expose an optional IP field, but Relay currently does not guarantee one.
- SSH Remote Device, remote installation, or SSH stdio proxy.
- Direct WS + token GUI setup.
- Account/OAuth identity.
- Importing every remote Host Project automatically into the GUI Project list.
- Moving IM extension settings to remote scope; IM settings remain local GUI/Host extension settings in this spec.

## Acceptance Criteria

- Opening GUI Settings -> Connections shows the official Relay as the default endpoint and does not show a Relay URL input until the user chooses edit.
- The pair action reads `Get Pair Code`.
- A pair code is still created with the default official Relay when the URL field has not been edited.
- Paired devices can be renamed from the Connections page, and the local name persists in `~/.scorel/gui-store.json`.
- Paired device details expose status, Device ID, Relay URL, and an IP row that is populated only when the device view has IP information.
- Settings nav shows the current Project scope instead of a disabled "此电脑" label.
- Selecting a remote Project in Settings changes the `GuiProjectRef` used by model/provider/memory/runtime settings, so model lists and provider edits are remote-scoped.
- Existing remote Project selection remains explicit: remote Projects appear in Settings only after the GUI has added that remote Project.

## Test Requirements

```bash
pnpm --filter @scorel/app-gui test -- src/main/gui-store.test.ts src/renderer/gui-shell.test.tsx
pnpm typecheck
pnpm test
```

Manual:

- Open GUI Settings -> Connections.
- Confirm the Relay URL input is hidden by default and `Get Pair Code` returns a pair code against the official Relay.
- Click edit, change Relay URL, and confirm pair/refresh use the edited URL.
- Pair or seed a Relay Device, rename it, refresh, and confirm the local name remains.
- Add a remote Project, open Settings, select that remote Project from the scope selector, and confirm Model/Provider pages show the remote Project's model profile.

## Impacted Files

- `apps/gui/src/main/gui-store.ts`
- `apps/gui/src/main.ts`
- `apps/gui/src/preload.ts`
- `apps/gui/src/shared/ipc.ts`
- `apps/gui/src/renderer/App.tsx`
- `apps/gui/src/renderer/settings/SettingsShell.tsx`
- `apps/gui/src/renderer/settings/SettingsNav.tsx`
- `apps/gui/src/renderer/settings/sections/ConfigSection.tsx`
- `apps/gui/src/renderer/styles.css`
- `apps/gui/src/main/gui-store.test.ts`
- `apps/gui/src/renderer/gui-shell.test.tsx`
- `docs/CHANGELOG.md`
- `docs/ROADMAP.md`

## Risks And Boundaries

- Device rename is GUI-local metadata, not a Relay identity mutation. Refresh must not overwrite a user's local name with a Relay label.
- Settings scope is Project-based because model/provider/memory/runtime APIs are Project-scoped. A bare remote Device without an added Project cannot safely act as the target for those settings.
- IP is optional because the current Relay protocol does not report it; the UI contract must tolerate absence without inventing a fake value.

## Status

Done.
