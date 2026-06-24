# S0108: GUI Bundled CLI Runtime

## Goal

Make the packaged desktop GUI self-contained for local Host startup.

The business value is that installing `Scorel.app` is enough to use the local GUI path. Users must not need a terminal-launched environment, a global `node`, a global `scorel`, or the source repository layout for GUI Settings and local Project workflows to work.

## Scope

- Vendor the same-version public `scorel` CLI release artifact into the macOS GUI bundle.
- Make packaged GUI startup resolve the local Host launcher from the app bundle, not from `PATH`.
- Keep development startup convenient through the existing source CLI path.
- Remove the packaged-build requirement for `SCOREL_CLI_ENTRYPOINT`.
- Add release/package tests proving the GUI bundle contract references `Contents/Resources/scorel`.
- Add a regression test for Finder/Dock-like startup where `PATH` does not contain Node.

## Not In Scope

- Publishing the GUI through npm.
- Replacing the CLI with a separate `scorel-host` binary.
- Changing `scorel host start` daemon lifecycle semantics.
- Changing the public CLI command surface.
- Adding LaunchAgent/login-item restart supervision.
- Supporting Windows/Linux GUI packaging in this spec.

## Contract

The packaged macOS app contains:

```text
Scorel.app
  Contents/Resources/
    scorel      # launcher script
    scorel.js   # bundled CLI artifact
    app.asar
```

Packaged GUI starts the local singleton Host with the bundle-owned executable:

```text
Contents/Resources/scorel host start --port 0 --cwd <bootstrap-project> --idle-timeout-ms <ms> --no-relay
```

Development GUI may continue to use the source entrypoint:

```text
node --import tsx apps/cli/src/index.ts host start ...
```

The packaged path must not depend on:

- `node` being discoverable in `PATH`;
- `scorel` being globally installed;
- `SCOREL_NODE_PATH`;
- `SCOREL_CLI_ENTRYPOINT`;
- `apps/cli/src/index.ts` existing inside the app bundle.

## Acceptance Criteria

- `apps/gui` Electron Builder config includes a generated `.runtime` directory containing `scorel` and `scorel.js` in `Contents/Resources`.
- The bundled `scorel` launcher uses the app's own Electron executable with `ELECTRON_RUN_AS_NODE=1` to run the built CLI artifact as `scorel.js`.
- Packaged GUI resolves the Host launcher to `process.resourcesPath/scorel`.
- Packaged GUI spawns `scorel` directly and does not prepend `node`, `tsx`, or source entrypoint args.
- Development GUI still supports `SCOREL_CLI_ENTRYPOINT` and `SCOREL_NODE_PATH` for local debugging.
- A unit test proves packaged Host startup uses the bundle CLI even with an empty/minimal `PATH`.
- Release tests prove the GUI package depends on the built CLI artifact and bundle destination.
- `docs/SHIP.md`, `docs/ROADMAP.md`, and `README.md` describe that GUI release assets include a bundled same-version CLI runtime.

## Test Requirements

```bash
pnpm --filter @scorel/app-gui test -- src/main/host-launcher.test.ts
node --test scripts/release-gui.test.mjs
pnpm --filter @scorel/app-gui build
pnpm build:package
git diff --check
```

Full release readiness still uses:

```bash
pnpm typecheck && pnpm test
pnpm release patch --dry-run
```

## Impacted Files

- `apps/gui/package.json`
- `apps/gui/src/main.ts`
- `apps/gui/src/main/host-launcher.ts`
- `apps/gui/src/main/host-launcher.test.ts`
- `apps/gui/scripts/build-runtime.mjs`
- `apps/gui/scripts/build-runtime.node-test.mjs`
- `scripts/release-gui.test.mjs`
- `docs/SHIP.md`
- `docs/ROADMAP.md`
- `README.md`

## Risks And Boundaries

- The vendored CLI must be built before `electron-builder` runs. Release flow already runs `pnpm build:package`; local `dist:mac` must do the same or fail clearly.
- The bundled CLI runs under Electron's Node mode. A fully native/self-contained CLI binary remains a possible future hardening step, but the packaged GUI no longer depends on user `PATH` for Node.
- The GUI must never call the user's global `scorel`, because that can drift from the GUI version and mutate the local Host contract.

## Status

Done.
