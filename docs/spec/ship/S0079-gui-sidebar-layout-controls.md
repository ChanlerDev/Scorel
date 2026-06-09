# S0079: GUI Sidebar Layout Controls

## Goal

Fix the GUI sidebar layout so long Project and Session titles stay inside the
sidebar, and add basic desktop controls for resizing and collapsing the sidebar.

## Scope

- Clip sidebar Project and Session titles to a single line with ellipsis.
- Prevent horizontal scrolling in the sidebar session list.
- Add a sidebar resize handle with bounded width.
- Add a macOS-style sidebar collapse button in the sidebar titlebar area.
- Add a matching expand button in the topbar when the sidebar is collapsed.

## Non-goals

- Persist sidebar width across app launches.
- Add keyboard shortcuts or menu commands.
- Change Host, Relay, Session JSONL, provider, or model selection behavior.

## Acceptance Criteria

- Long sidebar titles do not create a horizontal scrollbar.
- Session titles expose their full value through the native title tooltip.
- Users can drag the sidebar edge between a safe minimum and maximum width.
- Users can collapse and re-expand the sidebar from the window chrome area.

## Tests

- GUI rendering tests cover the sidebar collapse and resize affordances.
- GUI CSS contract tests cover horizontal overflow prevention and text clipping.
- `pnpm typecheck && pnpm test` passes.

## Impacted Files

- `apps/gui/src/renderer/App.tsx`
- `apps/gui/src/renderer/shell/Sidebar.tsx`
- `apps/gui/src/renderer/shell/ProjectTree.tsx`
- `apps/gui/src/renderer/workspace/Topbar.tsx`
- `apps/gui/src/renderer/workspace/Workspace.tsx`
- `apps/gui/src/renderer/styles.css`
- GUI renderer tests

## Risks

- Resize mouse listeners must be removed on mouseup to avoid stale global
  handlers.
- Collapsed sidebar must not hide the only way to expand the sidebar again.
