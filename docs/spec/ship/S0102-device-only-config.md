# S0102 Device Only Config

## Goal

Remove project-level config as a product concept. A Scorel device has exactly one editable config, stored at that device's Scorel home `config.toml`.

Projects are workspace/session objects. They do not own Provider, Model, Memory, Runtime, or Extension settings.

## Scope

- Core config loading reads only the device/user config file.
- Remove `.scorel/config.toml` from the public config schema and runtime loading contract.
- Settings writes always target the device config, even if an older request still includes a `projectId`.
- CLI daemon, CLI chat, GUI local host, and daemon fallback config reads pass the device `scorelHomeDir` explicitly so custom device roots do not read the process user's real `~/.scorel/config.toml`.
- Update current config docs/specs that describe project-scoped config.

## Not In Scope

- Changing Project/session ownership.
- Removing Project registry or remote Project selection.
- Adding migration for old project `.scorel/config.toml` files.
- Changing project-scoped Memory status or runtime stats, which are activity/status data, not config ownership.

## Acceptance Criteria

- `loadScorelConfig` and `loadScorelConfigProfile` ignore project `.scorel/config.toml`.
- If device config is missing, config loading reports the missing device config path.
- Provider/model/memory/runtime/extension Settings writes go to device `config.toml`.
- Requests with `projectId` do not create or mutate project `.scorel/config.toml`.
- Runtime creation for a Project still uses that device's single config.
- Docs describe config as device-only.

## Test Requirements

- Core config tests load from device/user config and prove project `.scorel/config.toml` is ignored.
- Daemon embedded tests prove Settings writes with `projectId` still write device config only.
- CLI daemon idle test continues to prove custom device state roots do not inherit active IM from the real user config.
- Run `pnpm typecheck && pnpm test`.

## Impacted Files

- `packages/core/src/config/index.ts`
- `packages/core/src/config/config.test.ts`
- `packages/daemon/src/index.ts`
- `packages/daemon/src/embedded/embedded.test.ts`
- `apps/cli/src/index.ts`
- `apps/cli/src/daemon-cli.ts`
- `apps/gui/src/main/local-host.ts`
- `docs/spec/extensions.md`
- `docs/spec/ship/S0097-rtk-token-saving-settings.md`
- `docs/spec/ship/S0086-auto-compact-and-session-memory.md`
- `docs/ROADMAP.md`
- `docs/CHANGELOG.md`

## Risks And Boundaries

- Pre-1.0 development rules allow removing this stale config surface rather than preserving compatibility.
- Old project `.scorel/config.toml` files may remain on disk, but runtime no longer treats them as config.
