# S0085: GUI IM Extension Settings

## Goal

Add a real GUI control for enabling the built-in Telegram IM extension.

The business value is that local GUI users no longer need to hand-edit `~/.scorel/config.toml` to try Telegram. The GUI writes the same user-level extension config that `scorel host serve` reads, and the embedded local Host applies the change immediately.

## Scope

- Add daemon/client protocol requests for reading and updating IM extension settings.
- Persist extension settings through the shared config renderer, preserving existing provider, memory, and model config.
- Refresh local Host IM adapters after settings are updated.
- Add a GUI Settings page for IM with a Telegram toggle and basic config fields:
  - credential mode: env or direct API key
  - `credentialMode`
  - `apiKey`
  - `botTokenEnv`
  - `pollIntervalMs`
  - `allowedChatIds`
  - `botUsername`
- Use `~/.scorel/config.toml` as the user-level config path for GUI extension settings.
- Include `extensions/` in package files and make built-in extension discovery work from the package root.

## Not In Scope

- Remote Relay IM control.
- Telegram manual smoke with a real bot token.
- GUI diagnostics timeline for extension startup errors.

## Acceptance Criteria

- GUI Settings exposes an IM page with a Telegram enable switch.
- Toggling Telegram writes `[extensions.telegram]` to `~/.scorel/config.toml`.
- Telegram config fields write `[extensions.telegram.config]`.
- Telegram can use either an env-backed token or a directly stored `apiKey`.
- Direct mode stays selected before an API key is entered.
- Updating settings triggers local Host IM extension refresh without restarting the GUI.
- Missing Telegram token does not crash the GUI; the extension remains configured but inactive.
- Built-in extension discovery works when running from an installed package.

## Testing Requirements

- Core config renderer test for extension settings merge.
- GUI local Host test for extension settings IPC path and persisted config.
- GUI shell render test includes the IM settings page in navigation.
- Full `pnpm typecheck && pnpm test`.
