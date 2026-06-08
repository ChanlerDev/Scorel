# S0066 GUI Local Project Workspace Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the GUI useful for local work by adding a Project-first local workspace with local Project registration, Session listing, Session creation, and a first prompt-sending chat surface over the embedded Host.

**Architecture:** Keep Electron main as the owner of Host/client state. Renderer remains a simple Entry UI over typed IPC commands. S0066 is local-only: no Relay, no SSH, no direct WS, no model picker, and no advanced Codex App panes.

**Tech Stack:** Electron IPC, TypeScript, embedded `ScorelHost`, `DaemonClient`, `@scorel/protocol` Session/Project types, Vitest, existing esbuild GUI pipeline.

---

## Task 1: Extend GUI IPC Contract For Local Workspace

**Files:**
- Modify: `apps/gui/src/shared/ipc.ts`
- Modify: `apps/gui/src/shared/global.d.ts`

**Steps:**

1. Add shared types:
   - `GuiLocalProject = HostProject & { source: "local" }`
   - `GuiSessionSummary` from protocol `SessionSummary`
   - `GuiChatEvent` minimal display event shape for local transcript
2. Extend `GuiApi` with:
   - `addLocalProject(): Promise<HostProject | null>`
   - `listLocalSessions(projectId: string): Promise<SessionSummary[]>`
   - `createLocalSession(projectId: string): Promise<SessionId>`
   - `openLocalSession(sessionId: string): Promise<PersistentEvent[]>`
   - `sendLocalMessage(sessionId: string, content: string): Promise<PersistentEvent[]>`
3. Keep all parameters opaque strings in IPC and cast to branded protocol IDs only in main.

**Verification:**

```bash
pnpm --filter @scorel/app-gui typecheck
```

## Task 2: Add Local Workspace Methods To Main Host Service

**Files:**
- Modify: `apps/gui/src/main/local-host.ts`
- Modify: `apps/gui/src/main/local-host.test.ts`

**Steps:**

1. Extend `GuiLocalHostService` with:
   - `listLocalSessions(projectId)`
   - `createLocalSession(projectId)`
   - `openLocalSession(sessionId)`
   - `sendLocalMessage(sessionId, content)`
2. Use existing `DaemonClient` methods:
   - `listSessions({ projectId })`
   - `createSession({ meta: { projectId } })`
   - `switchSession(sessionId)`
   - `getTree()`
   - `sendMessage(content)`
3. Test with real `ScorelRuntime` fake provider:
   - register local Project
   - create Session bound to Project
   - list Sessions for Project
   - send message
   - verify returned events include persisted user/assistant content
4. Keep `createRuntime` injectable so tests never require a real provider.

**Verification:**

```bash
pnpm --filter @scorel/app-gui test -- src/main/local-host.test.ts
pnpm --filter @scorel/app-gui typecheck
```

## Task 3: Add Desktop Folder Picker And IPC Handlers

**Files:**
- Modify: `apps/gui/src/main.ts`

**Steps:**

1. Import `dialog` from Electron.
2. Implement `addLocalProject` IPC:
   - open directory picker
   - return `null` when canceled
   - call `localHost.registerLocalProject(selectedPath)`
3. Add guarded IPC handlers for local sessions and message sending.
4. If Host status is not `connected`, handlers should return safe empty state or throw a user-facing error string, not leak low-level transport messages.

**Verification:**

```bash
pnpm --filter @scorel/app-gui typecheck
pnpm --filter @scorel/app-gui test
```

## Task 4: Replace Placeholder Renderer With Project-First Workspace

**Files:**
- Modify: `apps/gui/src/renderer.ts`
- Modify: `apps/gui/src/index.html`
- Modify: `apps/gui/src/package-boundaries.test.ts` if renderer-owned paths expand

**Steps:**

1. Render three stable regions:
   - left Project list
   - middle Session list for selected Project
   - main chat/composer surface for selected Session
2. On startup:
   - load Host status
   - load local Projects
   - auto-select first Project if available
   - load Sessions for selected Project
3. Add "Add Project" button using `window.scorel.addLocalProject()`.
4. Add "New Session" button for selected Project.
5. Add composer:
   - disabled when no Session is selected
   - sends through `sendLocalMessage`
   - re-renders transcript from returned persistent events
6. Keep styling Codex App-like but minimal; S0068 owns polish.
7. Do not introduce React in S0066 unless necessary.

**Verification:**

```bash
pnpm --filter @scorel/app-gui build
pnpm --filter @scorel/app-gui typecheck
pnpm --filter @scorel/app-gui test
```

## Task 5: Update Docs And Mark S0066 Done

**Files:**
- Modify: `docs/ROADMAP.md`
- Modify: `docs/spec/ship/S0066-gui-local-project-workspace.md`
- Modify: `docs/plans/2026-06-08-s0066-gui-local-project-workspace.md`

**Steps:**

1. Add exact S0066 verification commands if implementation changes them.
2. Mark M9.3 / S0066 `Done` only after focused checks, full checks, and GUI smoke.
3. Keep S0067-S0068 `Planned`.

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

**Manual smoke:**

```bash
pnpm gui
```

Expected:

- GUI starts with local Projects visible.
- Add Project opens the system directory picker and registers a local Project.
- Selecting a Project shows its Sessions.
- New Session creates a Session under the selected Project.
- Sending a prompt uses embedded local Host and persists JSONL.

Use a real local temporary Project directory and a real provider for the final prompt smoke if provider credentials are available. If provider credentials are not available, record that automated fake-provider tests cover the send path and real-provider smoke remains pending.

**Commit:**

```bash
git add apps/gui docs/ROADMAP.md docs/spec/ship/S0066-gui-local-project-workspace.md docs/plans/2026-06-08-s0066-gui-local-project-workspace.md
git commit -m "S0066: feat: add GUI local project workspace"
```

Do not add `.scorel/`, `self/`, `apps/gui/.dist`, or `node_modules`.
