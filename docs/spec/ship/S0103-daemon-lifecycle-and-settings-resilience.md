# S0103: Daemon Lifecycle And Settings Resilience

## Goal

Clarify daemon lifetime by entrypoint and make GUI Settings resilient when switching devices and sections, especially after selecting a Relay device.

Business value: a VPS demo host should stay online when the user explicitly starts it, while GUI/CUI convenience daemons still clean themselves up after local use. Settings failures must surface as recoverable errors, not a black renderer.

## Scope

- `scorel host start` launches a background host that stays alive until explicit stop, process signal, crash, or machine shutdown.
- `scorel host serve` is foreground: it stays alive until Ctrl+C / SIGTERM unless the user explicitly provides `--idle-timeout-ms`.
- GUI auto-start and `scorel up` auto-start keep the existing 15 minute idle shutdown policy.
- GUI auto-start binds an ephemeral local port so a user-owned daemon on the default port cannot make GUI startup fail.
- `--idle-timeout-ms 0` remains the explicit "no idle shutdown" value.
- GUI Settings must ignore stale settings responses from a previously selected device.
- GUI Settings must render a local error fallback instead of blacking out the whole app when a Settings section throws.
- CDP verification covers Settings remote-device switching without renderer errors.

## Not In Scope

- Changing active IM keepalive semantics. Active IM still prevents idle shutdown.
- Adding a new public `--keep-alive` flag; this spec keeps the existing `--idle-timeout-ms 0` primitive and fixes defaults.
- Remote SSH device installation or management.

## Acceptance Criteria

- Direct `scorel host start` spawns `host serve` with idle shutdown disabled by default.
- Direct `scorel host serve` does not idle-exit by default; Ctrl+C/SIGTERM still stops it.
- `scorel up` spawns the daemon with a 15 minute idle timeout.
- GUI auto-start spawns the daemon with a 15 minute idle timeout.
- GUI auto-start uses the persisted `daemon.json` actual port instead of assuming the default daemon port is free.
- Settings device changes reset device-scoped settings state and ignore stale async responses.
- Settings section render errors show an in-app fallback and do not remove the app shell.
- CDP GUI verification seeds a device config, switches to a remote device in Settings, flips across Settings sections, and fails on renderer errors.

## Tests

- CLI daemon tests cover background start idle disable, foreground serve default no-idle, explicit idle timeout, and active IM keepalive.
- `scorel up` tests assert the internal daemon spawn passes the 15 minute idle timeout.
- GUI renderer tests cover stale local settings data not overwriting remote settings data.
- CDP GUI verification covers remote Settings section switching and device-level config persistence.

## Files

- `apps/cli/src/daemon-cli.ts`
- `apps/cli/src/up-cli.ts`
- `apps/gui/src/main.ts`
- `apps/gui/src/renderer/App.tsx`
- `apps/gui/src/renderer/settings/SettingsShell.tsx`
- `apps/gui/src/renderer/settings/sections/ModelSection.tsx`
- `apps/gui/src/renderer/settings/sections/ProviderSection.tsx`
- `scripts/verify-m9-gui-cdp-e2e.ts`
- `docs/SHIP.md`
- `docs/ROADMAP.md`
- `docs/CHANGELOG.md`

## Risks

- A foreground host without idle shutdown can run forever. That is intended because terminal ownership and Ctrl+C are visible to the user.
- GUI/CUI auto-start must remain explicit about its 15 minute idle timeout; otherwise changing host defaults would make local helper daemons permanent.
