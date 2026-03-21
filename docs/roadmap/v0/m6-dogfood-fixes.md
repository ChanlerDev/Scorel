# V0-M6: Dogfood Fixes

> Approval UI buttons + Markdown rendering + Settings panel + default workspace + workspace history

## Origin

First manual dogfood session ([../../execution/dogfood/v0-manual.md](../../execution/dogfood/v0-manual.md)). Four issues discovered that block V0 from being genuinely usable.

## Goal

Fix the UI gaps uncovered by dogfood so that a real user can complete a full coding session without workarounds.

## Scope

### D1: Approval Buttons (Bug Fix)

**Problem**: M2 approval flow backend is complete — `tools.approve` / `tools.deny` IPC exposed in preload, `useChat` handles `approval.requested` event, `MessageList` renders "Awaiting approval" status label — but **no approve/deny buttons exist in the UI**. The user cannot interact with the approval flow.

**Solution**: Add Approve / Deny buttons in the tool call card when `status.state === "awaiting_approval"`.

```tsx
// In renderContentPart, when state === "awaiting_approval":
<button onClick={() => window.scorel.tools.approve(sessionId, part.id)}>Approve</button>
<button onClick={() => window.scorel.tools.deny(sessionId, part.id)}>Deny</button>
```

**Key decisions**:
- Buttons render inline in the tool call card (not a modal/dialog)
- Both buttons disabled once clicked (prevent double-fire)
- sessionId must be threaded through to MessageList (currently not passed)

### D2: Markdown Rendering

**Problem**: Assistant text rendered as `<span style={{ whiteSpace: "pre-wrap" }}>{part.text}</span>` — plain text, no markdown. Code blocks, lists, headings, inline code, bold/italic all display as raw text.

**Solution**: Integrate a lightweight markdown renderer for assistant text parts.

**Key decisions**:
- Library: `react-markdown` (mature, React-native, supports GFM) or `marked` + `DOMPurify` (lighter, manual)
- Scope: render only `TextPart` content in assistant messages; user messages stay plain text
- Code blocks: syntax highlighting deferred to V1 (plain `<pre><code>` in M6)
- Security: sanitize HTML output (XSS prevention) — especially important since content comes from LLM
- Thinking blocks: remain as italic plain text (no markdown parsing)

### D3: Settings Panel

**Problem**: Provider configuration only exists in `SetupWizard` (first-run). After initial setup, users cannot change API key, base URL, or model without deleting the database.

**Solution**: Add a Settings view accessible from the sidebar or menu.

**Scope**:
- View/edit existing provider config (displayName, baseUrl, model)
- Update API key (write-only — show "Key stored" / "No key" status, not the actual key)
- Test connection with updated config
- Add new provider (reuse SetupWizard configure/test steps)
- Delete provider
- No full_access / per-tool permission in M6 (→ V1 M1)

**Key decisions**:
- Settings as a full-page view (replaces chat area when active), not a modal
- Entry point: sidebar button or Cmd+, shortcut
- Reuse `SetupWizard` form components where possible
- Provider list + detail pattern (left: provider list, right: edit form)

### D4: App Default Workspace

**Problem**: Every New Chat requires `selectDirectory()` native file picker. High friction for casual use.

**Solution**: App creates a default workspace directory on first launch (e.g. `~/Scorel`). New sessions use this directory by default.

**Key decisions**:
- Default path: `~/Scorel` (user-visible, not buried in Library)
- Created on first app launch if not exists
- New Chat button creates session with default workspace immediately (no picker)
- User can still choose a different workspace via explicit action

### D5: Workspace History

**Problem**: Even when users have used multiple project directories, they must re-navigate the file picker each time.

**Solution**: Remember previously used workspace paths. New Chat presents a workspace selector with history.

**Key decisions**:
- Storage: `workspaces` table in SQLite — `path`, `lastUsedAt`, `label` (optional)
- Populated automatically when sessions are created
- New Chat flow: show recent workspaces as a list + "Browse..." button for new ones
- Default workspace always appears first
- Max history: 20 entries (LRU eviction)
- Validate on display: gray out paths that no longer exist on disk

## Out of Scope (M6)

- Syntax highlighting in code blocks (→ V1)
- Full access toggle / per-tool permission config (→ V1 M1)
- Reject with reason (→ V1 M1)
- Workspace rename / remove from history (→ V1)
- Image rendering in messages (→ V1+)

## Acceptance Criteria

- [ ] **Case K**: Approve tool call via UI button → tool executes → result displayed in chat
- [ ] **Case K'**: Deny tool call via UI button → error result fed back → model adapts
- [ ] **Case L**: Assistant response with markdown (code block, list, inline code, heading) renders correctly
- [ ] **Case M**: Change provider API key in Settings → next chat request uses new key
- [ ] **Case N**: New Chat creates session with default workspace without folder picker
- [ ] **Case N'**: New Chat → select from workspace history → session created with chosen workspace
- [ ] Markdown XSS: `<script>` tags in LLM output are sanitized (not executed)
- [ ] Settings accessible via Cmd+, shortcut
- [ ] Default workspace `~/Scorel` created on first launch

## Files to Create/Modify

| File | Action |
|------|--------|
| `src/renderer/components/MessageList.tsx` | Modify: add approve/deny buttons, markdown rendering |
| `src/renderer/components/ChatView.tsx` | Modify: thread sessionId to MessageList for approval IPC |
| `src/renderer/components/SettingsView.tsx` | Create: provider CRUD, API key update, test connection |
| `src/renderer/App.tsx` | Modify: add Settings navigation, workspace selector for New Chat |
| `src/main/storage/db.ts` | Modify: add `workspaces` table migration |
| `src/main/ipc-handlers.ts` | Modify: add workspace history IPC handlers |
| `src/main/index.ts` | Modify: create default workspace on first launch |
| `src/preload/index.ts` | Modify: add workspaces.* and settings navigation IPC |
| `package.json` | Modify: add react-markdown (or chosen library) dependency |

## Definition of Done

A user can complete a full coding session: New Chat (with default workspace or history pick) → chat → tool call (approve/deny via visible buttons) → read markdown-rendered response → change API key in Settings → continue chatting. No workarounds needed for any core flow.
