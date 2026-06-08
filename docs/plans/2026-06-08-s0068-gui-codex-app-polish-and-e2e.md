# S0068 GUI Codex App Polish And E2E Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Polish the first Electron GUI milestone into a credible Codex App-style workbench and record local + Relay verification evidence.

**Architecture:** Keep the S0065-S0067 architecture unchanged: Electron main owns Host, Relay, persistence, and IPC; renderer remains a browser-safe workbench. S0068 only tightens UI states, layout, and evidence; it does not introduce new product surfaces.

**Tech Stack:** Electron, plain TypeScript renderer, CSS tokens from `docs/design.md`, Vitest, local Relay server for automated Relay path evidence.

---

### Task 1: Tighten Workbench Styling

**Files:**
- Modify: `apps/gui/src/index.html`
- Modify: `apps/gui/src/renderer.ts`

**Steps:**
1. Convert CSS to explicit design tokens from `docs/design.md`.
2. Keep a dense three-column desktop layout but make the main transcript and composer feel like a desktop app rather than a web page.
3. Add stable row heights, status chips, text truncation, focus states, and composer controls.
4. Keep S0068 polish scoped: no icons library, no plugin panels, no installers.

### Task 2: Add Explicit State Copy

**Files:**
- Modify: `apps/gui/src/renderer.ts`
- Modify: `apps/gui/src/index.html`

**Steps:**
1. Add distinct empty/loading/error/disconnected/offline states in the workbench.
2. Display remote Device status next to Relay Devices and selected Relay Project.
3. Keep local Host error readable without leaking low-level stack traces.
4. Make Add Remote Project recoverable when Relay Device is absent or offline.

### Task 3: Extend Verification Coverage

**Files:**
- Modify: `apps/gui/src/main/local-host.test.ts`
- Modify: `apps/gui/src/main/relay-service.test.ts`

**Steps:**
1. Verify local Project session switching does not leak events from another session.
2. Verify Relay Project can create a session and send a prompt through real local Relay + real HostRelayClient.
3. Use fake Runtime provider only inside automated tests; real provider/manual GUI evidence is documented separately.

### Task 4: Record Evidence And Close M9

**Files:**
- Modify: `docs/spec/ship/S0068-gui-codex-app-polish-and-e2e.md`
- Modify: `docs/ROADMAP.md`
- Optional: create `docs/spec/ship/S0068-gui-e2e-verification.md`

**Steps:**
1. Run focused GUI build/typecheck/test.
2. Run full `pnpm typecheck`, `pnpm test`, `pnpm pack:smoke`, and `git diff --check`.
3. Start `pnpm gui`, confirm Electron loads at desktop size, and terminate it cleanly.
4. Attempt real-provider prompt smoke if local provider config is available; otherwise document it as not run and keep M9 status out of Done if required.
5. Mark S0068 Done and M9 Done only if the implemented and verified evidence satisfies the spec.
