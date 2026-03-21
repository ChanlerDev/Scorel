# M6 Dogfood Fixes — Implementation Review

> Reviewer: Claude | Base: `586a4e2` (main) | 19 files changed (+1476 / -49) | 172 tests passing | tsc clean

## Summary

M6 implements all five dogfood-fix items (D1–D5) from the spec. Overall quality is good — security invariants respected, approval flow properly guarded against double-fire, DB migration includes backfill, and the `testExisting` IPC correctly keeps secrets in the main process. Below are the issues found, ordered by priority.

---

## Issues

### P1 — WorkspacePicker label always shows "Recent workspace"

**File**: `src/renderer/components/WorkspacePicker.tsx:63`

**Problem**: The fallback `workspace.label ?? "Recent workspace"` always fires because `upsertWorkspace()` is never called with a `label` argument — the only call site is `ipc-handlers.ts:67` which passes just the path. Every history entry displays the generic string "Recent workspace" instead of something useful.

**Fix**: Replace the label fallback with the formatted path:

```tsx
// Before
label={workspace.label ?? "Recent workspace"}

// After
label={workspace.label ?? formatWorkspaceLabel(workspace.path)}
```

This shows `~/Projects/my-app` instead of "Recent workspace" for every entry.

---

### P2 — Approval action failure is silent

**File**: `src/renderer/components/MessageList.tsx:282-290`

**Problem**: `handleApprovalAction` catches IPC errors and resets the `pendingApprovals` state, but the user gets zero feedback. If the session has ended or the orchestrator rejects the call, the buttons simply re-enable with no explanation.

**Fix**: Add an `approvalError` state (or a transient toast) to surface the failure:

```tsx
// Option A: inline error state
const [approvalError, setApprovalError] = useState<string | null>(null);

void action.catch((err: unknown) => {
  setPendingApprovals((current) => { ... });
  setApprovalError(err instanceof Error ? err.message : "Approval action failed");
});

// Render near the buttons:
{approvalError && <div style={{ color: "var(--danger)", marginTop: 4, fontSize: 12 }}>{approvalError}</div>}
```

---

### P3 — WorkspacePicker missing Escape key to close

**File**: `src/renderer/components/WorkspacePicker.tsx:33`

**Problem**: The modal overlay has a Cancel button but no keyboard shortcut. macOS users expect Escape to dismiss dialogs.

**Fix**: Add a `useEffect` for the keydown listener:

```tsx
useEffect(() => {
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape" && !creating) {
      onClose();
    }
  };
  window.addEventListener("keydown", handleKeyDown);
  return () => window.removeEventListener("keydown", handleKeyDown);
}, [creating, onClose]);
```

---

### P4 — Missing LRU eviction test for >20 workspaces

**File**: `tests/unit/workspace-db.test.ts`

**Problem**: The implementation has a correct transactional LRU eviction in `upsertWorkspace` (deletes rows beyond top 20), but no test covers this. If the eviction SQL is accidentally broken, nothing catches it.

**Fix**: Add a test case:

```ts
it("evicts oldest entries when workspace count exceeds 20", () => {
  for (let i = 0; i < 25; i++) {
    upsertWorkspace(db, `/tmp/ws-${String(i).padStart(2, "0")}`);
  }

  const workspaces = listWorkspaces(db, 100);
  expect(workspaces).toHaveLength(20);
  // Oldest 5 (ws-00 through ws-04) should be gone
  expect(workspaces.some((w) => w.path === "/tmp/ws-00")).toBe(false);
  expect(workspaces.some((w) => w.path === "/tmp/ws-24")).toBe(true);
});
```

---

### P5 — `handleTestExisting` dirty-check message is confusing

**File**: `src/renderer/components/SettingsView.tsx:191-194`

**Problem**: When the user edits config fields but doesn't enter a new API key and clicks "Test Connection", the message says:

> "Save config changes first, or enter a new API key to test unsaved changes."

This is technically correct but UX-unclear — it reads like two alternatives but the user can't easily tell which action to take.

**Fix**: Split into two clearer messages or simplify:

```ts
// Option: simpler message
setFeedback("Save your changes before testing, or enter a new API key to test with.", "danger");
```

Or better — auto-save before testing when the draft is dirty, eliminating the edge case entirely.

---

### P6 — `react-markdown` version diverges from design doc

**File**: `package.json`

**Problem**: Design doc specifies `react-markdown ^9.0.0`, implementation uses `^10.1.0`. The code works (tests pass, API is compatible), but the design doc is now out of sync.

**Fix**: Update `docs/plan/M6-design.md` §10 to reflect `^10.1.0`. No code change needed.

---

## Spec Deviation Audit

| Spec Requirement | Implementation | Verdict |
|---|---|---|
| Approve/Deny buttons inline in tool card | Inline buttons with double-click prevention | Exceeds spec |
| `react-markdown` v9 | v10.1.0 (API compatible) | Acceptable, update doc |
| "Both buttons disabled once clicked" | `pendingApprovals` state + opacity + disabled | Exceeds spec |
| Reuse SetupWizard form components | Reuses `setup-wizard-model.ts` logic, independent UI | Correct per design doc §12 |
| Max 20 entries, LRU eviction | Transactional eviction on write | Exceeds spec |
| Validate on display: gray out missing paths | `fs.existsSync` + `opacity: 0.7` + disabled button | Matches spec |
| Default workspace `~/Scorel` | Created on first launch via `app-config.ts` | Matches spec |
| Cmd+, opens Settings | Menu item with accelerator + IPC event | Matches spec |
| XSS: `<script>` sanitized | `react-markdown` escapes HTML by default, test coverage | Matches spec |
| Acceptance Cases K/K'/L/M/N/N' | All covered | Pass |

---

## Positive Highlights

1. **Security**: `testExisting` IPC keeps API keys in main process; renderer never sees stored secrets
2. **DB migration backfill**: Existing session workspaces auto-populate the new `workspaces` table
3. **`app-config.ts` testability**: `opts.homeDir` injection avoids touching real `~/Scorel` in tests
4. **Approval guard**: Three-layer protection (pendingApprovals + useEffect cleanup + catch recovery)
5. **SetupWizard auto-workspace**: Unspecified but valuable — first-run setup auto-fills default workspace path
