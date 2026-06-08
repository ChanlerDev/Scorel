# S0065 GUI Electron Shell And Embedded Host Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the first `apps/gui` Electron shell and prove the GUI can connect to an embedded local Scorel Host without changing the public CLI npm package.

**Architecture:** `apps/gui` is a private workspace app. Electron main owns the local embedded `ScorelHost`, exposes a narrow IPC bridge, and the renderer stays an Entry UI that only asks for Host status and local Projects. Electron runs generated JavaScript from `.dist`; source TypeScript is compiled by a tiny esbuild script before launch.

**Tech Stack:** Electron, esbuild, TypeScript `NodeNext`, `@scorel/daemon`, `@scorel/client`, `@scorel/protocol`, Vitest, existing pnpm workspace.

---

## Task 1: Add GUI Workspace Package Skeleton

**Files:**
- Create: `apps/gui/package.json`
- Create: `apps/gui/tsconfig.json`
- Create: `apps/gui/scripts/build.mjs`
- Create: `apps/gui/src/main.ts`
- Create: `apps/gui/src/preload.ts`
- Create: `apps/gui/src/renderer.ts`
- Create: `apps/gui/src/index.html`
- Create: `apps/gui/src/shared/ipc.ts`
- Create: `apps/gui/src/shared/global.d.ts`
- Modify: `package.json`
- Modify: `pnpm-workspace.yaml`

**Steps:**

1. Add `@scorel/app-gui` as a private workspace package.
2. Keep Electron scoped to `apps/gui` and add `electron` to `pnpm-workspace.yaml` build allowlist.
3. Add `pnpm gui` at the root as a dev convenience only; do not add GUI files to root package `files`.
4. Add `scripts/build.mjs` that compiles:
   - `src/main.ts` -> `.dist/main.cjs`
   - `src/preload.ts` -> `.dist/preload.cjs`
   - `src/renderer.ts` -> `.dist/renderer.js`
   - copies `src/index.html` -> `.dist/index.html`
5. Electron `dev` runs `pnpm build && electron .`.

**Focused verification:**

```bash
pnpm install
pnpm --filter @scorel/app-gui build
pnpm --filter @scorel/app-gui typecheck
```

Expected: build and typecheck pass.

## Task 2: Add Main-Process Embedded Host Service

**Files:**
- Create: `apps/gui/src/main/local-host.ts`
- Create: `apps/gui/src/main/local-host.test.ts`

**Steps:**

1. Add `createGuiLocalHostService(options)`.
2. Service owns:
   - `ScorelHost`
   - `DaemonClient`
   - `createEmbeddedTransport(host)`
3. Use `ScorelHostOptions["createRuntime"]` for the injected runtime factory type.
4. Default runtime factory should use `createRealRuntime` and `loadScorelConfig({ cwd: project.workDir })`.
5. `start()` creates the GUI state session directory, starts Host, connects client, and cleans up if any part fails.
6. `stop()` disconnects client and shuts down Host; repeated start/stop should be harmless.
7. Test with a real `ScorelRuntime` and fake provider, following `packages/daemon/src/embedded/embedded.test.ts`; do not pass a partial runtime object.

**Focused verification:**

```bash
pnpm --filter @scorel/app-gui test -- src/main/local-host.test.ts
pnpm --filter @scorel/app-gui typecheck
```

Expected: PASS.

## Task 3: Add IPC Bridge For Status And Local Projects

**Files:**
- Create: `apps/gui/src/shared/ipc.ts`
- Create: `apps/gui/src/shared/global.d.ts`
- Modify: `apps/gui/src/main.ts`
- Modify: `apps/gui/src/preload.ts`
- Modify: `apps/gui/src/renderer.ts`
- Modify: `apps/gui/src/index.html`

**Steps:**

1. Define `GuiHostStatus`, `GuiApi`, and stable IPC channel names.
2. Main process starts local Host with state dir `~/.scorel/gui`.
3. Main process registers IPC handlers:
   - `scorel:getHostStatus`
   - `scorel:listLocalProjects`
4. Preload exposes only the typed `window.scorel` API through `contextBridge`.
5. Renderer renders:
   - Host status
   - local Project list
   - minimal Codex-style empty workspace placeholder
6. Renderer must not import `@scorel/core`, `@scorel/daemon`, or Node builtins.

**Focused verification:**

```bash
pnpm --filter @scorel/app-gui build
pnpm --filter @scorel/app-gui typecheck
```

Expected: PASS.

## Task 4: Add Package Boundary Tests

**Files:**
- Create: `apps/gui/src/package-boundaries.test.ts`

**Steps:**

1. Test root `package.json.files` does not include `apps/gui`.
2. Recursively scan renderer-owned files:
   - `src/renderer.ts`
   - `src/preload.ts`
   - `src/shared/**/*.ts`
3. Reject imports of:
   - `@scorel/core`
   - `@scorel/daemon`
   - `node:`

**Focused verification:**

```bash
pnpm --filter @scorel/app-gui test -- src/package-boundaries.test.ts
pnpm pack:smoke
```

Expected: PASS; public package smoke remains CLI-only and excludes GUI files.

## Task 5: Update S0065 Docs And Roadmap Status

**Files:**
- Modify: `docs/ROADMAP.md`
- Modify: `docs/spec/ship/S0065-gui-electron-shell-and-embedded-host.md`
- Modify: `docs/plans/2026-06-08-s0065-gui-electron-shell-embedded-host.md`

**Steps:**

1. Add the exact GUI verification commands to S0065 if they differ from the original spec.
2. After verification passes, mark M9.2 / S0065 `Done` in `docs/ROADMAP.md`.
3. Keep S0066-S0068 `Planned`.

## Task 6: Full Verification And Commit

**Focused checks:**

```bash
pnpm --filter @scorel/app-gui build
pnpm --filter @scorel/app-gui typecheck
pnpm --filter @scorel/app-gui test
```

**Full checks:**

```bash
pnpm typecheck
pnpm test
pnpm pack:smoke
git diff --check
```

**GUI smoke:**

```bash
pnpm gui
```

Expected:

- Electron window opens.
- Host status shows `connected`.
- Project list renders without crashing.
- Closing the window shuts down cleanly.

If GUI smoke cannot run in the current environment, record the limitation explicitly in the final handoff.

**Commit:**

```bash
git add apps/gui package.json pnpm-lock.yaml pnpm-workspace.yaml docs/ROADMAP.md docs/spec/ship/S0065-gui-electron-shell-and-embedded-host.md docs/plans/2026-06-08-s0065-gui-electron-shell-embedded-host.md
git commit -m "S0065: feat: add GUI Electron shell"
```

Do not add `.scorel/` or `self/`.
