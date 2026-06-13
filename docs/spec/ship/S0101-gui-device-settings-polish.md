# S0101 GUI Device Settings Polish

## Goal

Fix GUI settings so configuration is device-scoped, not Project-scoped, and polish the settings interactions surfaced by the latest Provider / Token / Connection review.

One device has one configuration. The Settings scope selector chooses a device:

- `此电脑` configures the local device.
- A Relay device configures that remote device.
- Projects remain workspace/session objects and must not appear as the settings configuration scope.

## Scope

- Settings left scope selector becomes device-based.
- GUI settings IPC for model profile, Provider catalog/deletion, memory settings, and runtime settings targets only a device.
- Daemon/client config requests used by GUI are device-level and write the device user config at `~/.scorel/config.toml` for that daemon.
- Provider deletion moves into the top Provider configuration form area, aligned to the lower-right of the Provider parameter block.
- Runtime token statistics use understandable Chinese labels and expose both output token total and saved token estimate.
- Relay device rows have an explicit expand affordance.
- Relay device rename is inline: a small edit icon next to the device name turns the name into an input.

## Not In Scope

- Changing session/project ownership: sessions still belong to Projects.
- Redesigning Project registry or remote Project selection.
- Creating per-Project settings overrides.
- Reworking IM extension settings beyond existing user-config behavior.
- Changing RTK savings math.

## Acceptance Criteria

- Settings selector labels are device names only, for example `此电脑` and `Remote Device`; it does not render `此电脑 / ProjectName` or `Device / ProjectName`.
- Settings Provider/Model/Memory/Runtime mutations do not accept a Project in GUI IPC.
- Daemon writes GUI settings requests to device-level user config.
- Provider delete is visually close to Provider credentials/configuration, not in a separate bottom danger row.
- Runtime token stats are Chinese and self-explanatory.
- Relay device rows visibly indicate expand/collapse and rename through a name-adjacent edit icon.

## Test Requirements

- Update renderer tests for device settings scope, Provider delete placement, Runtime labels, and inline Relay device rename affordance.
- Add or update daemon/local-host tests proving projectless settings write `config.toml` under device user config.
- Run targeted GUI/protocol/daemon tests covering changed paths.
- Run `pnpm typecheck && pnpm test` before shipping.

## Impacted Files

- `packages/protocol/src/events.ts`
- `packages/protocol/src/wire.ts`
- `packages/client/src/index.ts`
- `packages/daemon/src/index.ts`
- `apps/gui/src/main.ts`
- `apps/gui/src/main/local-host.ts`
- `apps/gui/src/main/relay-service.ts`
- `apps/gui/src/preload.ts`
- `apps/gui/src/shared/ipc.ts`
- `apps/gui/src/renderer/App.tsx`
- `apps/gui/src/renderer/settings/*`
- `apps/gui/src/renderer/styles.css`
- `docs/ROADMAP.md`
- `docs/CHANGELOG.md`

## Risks And Boundaries

- Memory status is a Project activity/status concept; this spec keeps Settings focused on Memory configuration, not Project activity status.
