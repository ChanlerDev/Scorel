# S0105: CLI Update And GUI Release

## Goal

Make Scorel's user-facing command surface complete enough for release users, and make CLI / GUI updates part of the same release story.

## Scope

- Add top-level `scorel version` / `scorel --version`.
- Add manual `scorel update` and `scorel upgrade` commands for the public npm package.
- Add Host-side automatic npm update checks:
  - check npm latest once per hour
  - install only when no active work is running, or active work has been stale for at least three hours
  - after a successful background update, stop the Host with an `auto-update` reason so the next entry start uses the new binary
- Keep `scorel` as the default interactive project command, and keep lifecycle/diagnostic commands grouped under product nouns: `host`, `pair`, `relay`, `webui`, `up`, `project`, `logs`.
- Add GUI release packaging to the same GitHub Release:
  - Electron macOS dmg + zip targets
  - `latest-mac.yml`
  - `.blockmap` metadata for incremental updates
  - `electron-updater` bootstrap in packaged GUI builds
- Add normal desktop update affordances:
  - application menu `Check for Updates...`
  - macOS status bar menu with show, settings, check updates, Host status, and quit
- Document unsigned macOS build handling for users without an Apple Developer account.

## Non-Goals

- Do not add auth/account commands before Scorel has a real account system.
- Do not add deprecated aliases for old command shapes.
- Do not publish GUI through npm.
- Do not claim notarization or Gatekeeper trust without Apple Developer signing credentials.
- Do not make Relay or hosted WebUI own update state.

## Contract

### CLI Surface

The stable user command groups are:

```text
scorel [--session <id>] [--cwd <dir>]
scorel chat [--session <id>] [--cwd <dir>]
scorel attach --session <id> --remote <ws-url> --token <token>
scorel host start|serve|status|stop|reset
scorel pair <pair-code>
scorel relay serve
scorel webui
scorel up
scorel project list|add|remove
scorel logs
scorel version
scorel update
scorel upgrade
```

This mirrors the broad shape used by mature agent CLIs: one default interactive command, explicit session/control commands, and a direct update command.

### CLI Update

`scorel update` and `scorel upgrade` both:

- query `npm view @chanlerdev/scorel version`
- compare against the installed package version with semver ordering
- run `npm install -g @chanlerdev/scorel@<latest>` only when latest is newer
- print a clear no-op message when already current

Host auto-update uses the same updater helper. The active-work gate is generic: it reads Host runtime/queue activity, not filenames, paths, screenshots, or one failure sample.

### GUI Release

`apps/gui` remains private and separate from the npm CLI package. Release packaging uses Electron Builder with GitHub provider metadata so `electron-updater` can check the same GitHub Release.

The release asset set is:

```text
<npm pack tarball>
apps/gui/release/latest-mac.yml
apps/gui/release/*.dmg
apps/gui/release/*.dmg.blockmap
apps/gui/release/*.zip
apps/gui/release/*.zip.blockmap
```

The macOS Action runs with `CSC_IDENTITY_AUTO_DISCOVERY=false` until signing/notarization credentials exist.

## Acceptance Criteria

- `scorel --help` lists update/version commands.
- `scorel --version` and `scorel version` print the installed version.
- `scorel update` / `scorel upgrade` have tested npm check/install behavior.
- Host auto-update gate is covered by tests.
- GUI packaged app initializes `electron-updater` only when packaged.
- GUI exposes manual update checks from both the application menu and the macOS status bar menu.
- GUI registers a macOS status bar menu with Host status and common app actions.
- Release script version lockstep includes `apps/gui/package.json`.
- Release script uploads GUI installer/update metadata assets to GitHub Release.
- README documents manual update, automatic update, GUI packaging, and unsigned macOS `xattr` workaround.

## Test Requirements

```bash
pnpm --filter @scorel/app-cli test -- update-cli.test.ts
pnpm --filter @scorel/app-gui test -- main-menu.test.ts
node --test scripts/release-gui.test.mjs
pnpm typecheck
pnpm test
git diff --check
```

## Affected Paths

- `apps/cli/src/index.ts`
- `apps/cli/src/update-cli.ts`
- `apps/cli/src/daemon-cli.ts`
- `packages/daemon/src/index.ts`
- `apps/gui/package.json`
- `apps/gui/src/main.ts`
- `scripts/release.mjs`
- `.github/workflows/release.yml`
- `README.md`
- `docs/SHIP.md`
- `docs/ROADMAP.md`

## Risks

- `npm install -g` can fail on machines where the user lacks permission for the global prefix. The command reports the npm error instead of silently mutating local state.
- Auto-updating a running Host cannot replace the current Node process in-place. The short-stop mechanism exits after successful installation; GUI/WebUI/CLI entrypoints can then start the new binary.
- Unsigned macOS apps are viable for local distribution but not trustworthy public distribution. Notarization should be added once an Apple Developer account is available.
