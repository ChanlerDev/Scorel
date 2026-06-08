# S0067 GUI Relay Device And Remote Project Selection Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add Relay Device pairing, remote directory browsing, and GUI-selected remote Project visibility to the Electron GUI.

**Architecture:** Keep the GUI project-first. Local Projects still come directly from the embedded Host Registry, while remote Projects are shown only when the GUI store has explicitly selected `deviceId + projectId`. The main process owns Relay sockets, `DaemonClient` instances, and file-backed GUI preferences under `~/.scorel/gui`; the renderer receives sanitized state through IPC.

**Tech Stack:** Electron main/preload/renderer, `@scorel/client` `RelayTransport`/`DaemonClient`, existing Relay pairing protocol, Node file-backed JSON store, Vitest.

---

### Task 1: Add GUI Remote Store

**Files:**
- Create: `apps/gui/src/main/gui-store.ts`
- Test: `apps/gui/src/main/gui-store.test.ts`

**Steps:**
1. Define `GuiRelayDevice`, `GuiVisibleRemoteProject`, and `GuiStoreSnapshot`.
2. Persist the snapshot to `~/.scorel/gui/gui-store.json` with atomic-ish write through a temporary file.
3. Add helpers to upsert Relay Devices, list devices, upsert visible remote Projects, and hide visible remote Projects without deleting Host state.
4. Test malformed or missing JSON returning an empty snapshot only when the file is absent; malformed JSON should throw.
5. Test that visible remote Projects are keyed by `deviceId + projectId` and do not require storing the remote Host Registry.

### Task 2: Add Relay Device Service

**Files:**
- Create: `apps/gui/src/main/relay-service.ts`
- Test: `apps/gui/src/main/relay-service.test.ts`
- Modify: `apps/gui/package.json`

**Steps:**
1. Import `ws` as the main-process WebSocket implementation if Node/Electron does not expose a compatible global.
2. Implement `createRelayPairSession(relayUrl, clientId)` by sending `entry_hello` and `create_pair_session`.
3. Implement `listAuthorizedDevices(relayUrl, clientId)` and persist selected devices into the GUI store.
4. Implement remote `DaemonClient` connection through `RelayTransport`.
5. Expose methods for remote `listDirectories`, `registerProject`, `listSessions`, `createSession`, `openSession`, and `sendMessage`.
6. Cache connected remote clients by `deviceId` and close them on app shutdown.
7. Test with a real local Relay server and embedded Host Relay client, not a fake daemon protocol.

### Task 3: Extend IPC Contract

**Files:**
- Modify: `apps/gui/src/shared/ipc.ts`
- Modify: `apps/gui/src/preload.ts`
- Modify: `apps/gui/src/main.ts`

**Steps:**
1. Add typed Project source wrappers: local and relay.
2. Add IPC methods for GUI snapshot, pair-code creation, authorized device refresh, remote directory listing, remote project registration, hidden selected remote project, and source-aware session/message operations.
3. Keep errors sanitized; do not return raw Relay frame payloads or secrets to renderer.
4. Ensure `before-quit` stops local Host and closes remote clients.

### Task 4: Add Renderer Settings And Add Project Flow

**Files:**
- Modify: `apps/gui/src/renderer.ts`
- Modify: `apps/gui/src/index.html`

**Steps:**
1. Add a Settings panel that can create a Relay pair code and refresh authorized devices.
2. Update Add Project so the user chooses Local or a configured Relay Device.
3. For Relay, browse directories via `listDirectories`, register the selected path on the remote Host, then store the returned `projectId` as GUI-visible.
4. Render local Projects plus only selected remote Projects in the main list.
5. Route session creation/open/send by Project source.
6. Add disconnected/offline/error text that is useful but not a full visual polish pass; S0068 owns final polish.

### Task 5: Verification And Spec Closure

**Files:**
- Modify: `docs/spec/ship/S0067-gui-relay-device-and-remote-project-selection.md`
- Modify: `docs/ROADMAP.md`

**Steps:**
1. Run focused GUI typecheck, tests, and build.
2. Run full repo `pnpm typecheck`, `pnpm test`, and `git diff --check`.
3. Run `pnpm gui` enough to verify the Electron app loads after IPC expansion.
4. Update S0067 with actual verification evidence and mark S0067 Done in ROADMAP.
5. Commit as `S0067: feat: add GUI Relay project selection`.
