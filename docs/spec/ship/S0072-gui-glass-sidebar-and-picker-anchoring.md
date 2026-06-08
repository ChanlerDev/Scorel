# S0072: GUI Glass Sidebar And Picker Anchoring

## Goal

Tighten the Codex App alignment after S0071 using the latest reference screenshots:
make the GUI sidebar read as transparent macOS glass, remove user-visible entries for
features that are not implemented, fix the empty workspace copy, and anchor the project
picker to the project pill instead of floating in the center of the workspace.

This is a GUI polish follow-up only. It does not change Host, Relay, Session JSONL,
provider execution, or package distribution boundaries.

## Scope

- Make the main sidebar and settings sidebar use translucent glass-like surfaces over
  the Electron vibrancy window, while keeping light and dark theme tokens.
- Remove disabled placeholders for features that do not exist. In this spec that means
  Search, Plugins, Automations, attachment add, permission policy dropdown, model picker,
  microphone, placeholder Settings sections, disabled config controls, and fake config
  links. Keep New Chat, Settings, Add Local Project, Add Remote Project, and Relay
  pairing/refresh because those are implemented paths.
- Empty workspace copy:
  - with no selected Project: `我们要构建什么？`
  - with a selected Project: `我们应该在 {Project} 中构建什么？`
- Project picker visibility:
  - when no Project is selected, keep a compact `选择项目` pill.
  - when a Project is selected, show a compact project pill in the composer footer area,
    not a long row that visually consumes the composer context strip.
- Sidebar `添加项目` must reuse the same project picker component and menu behavior as
  the composer project pill. It must not bypass the picker and directly open the local
  folder dialog.
- Project picker placement follows the trigger pill. The popover must be anchored near
  the clicked pill and must not float in the center of the workspace.
- In the selected-project empty heading, `{Project}` is clickable and opens the same
  project picker.
- Hide project metadata that is not currently backed by user-controllable GUI features,
  including `本地模式`, `Relay 远程`, and `main`.
- Focusing the composer textarea must not add an extra outer ring around the whole
  composer shell.
- Remove `不使用项目` from the picker. GUI remains Project-first per S0064.
- It is acceptable to keep implemented add actions: Add Local Project and Add Remote
  Project.

## Not In Scope

- Global Search implementation.
- Plugin, Automation, model picker, microphone, or permission-policy implementation.
- SSH remote device, direct WS + token, or HTTP API.
- WebUI reuse of GUI components.
- Replacing Electron with SwiftUI/AppKit.

## Acceptance Criteria

- Sidebar visually reads as a macOS glass/source-list surface in both light and dark
  themes, rather than an opaque flat panel.
- Primary sidebar shows only implemented top-level commands: New Chat and Settings,
  plus Project list/add controls.
- Settings exposes only implemented controls in this pass: Relay pairing/refresh. It
  must not show placeholder sections like MCP, Browser, Computer Control, Hooks, Git,
  or disabled config controls.
- Empty workspace without a selected Project says `我们要构建什么？`.
- Empty workspace with a selected Project says `我们应该在 {Project} 中构建什么？`.
- The selected Project name inside that heading is an interactive project picker trigger.
- The sidebar add-project control and composer project control share the same picker
  component and expose the same Add Local / Add Remote actions.
- Project picker opens next to the triggering pill, both from empty workspace and session
  workspace, and is not centered on the page.
- Selected-project pill stays compact; it does not become a full-width `选择项目` strip.
- Picker contains Add Local Project and Add Remote Project, but no null-project option.
- Composer project context does not render unsupported mode/branch labels such as
  `本地模式` or `main`.
- Textarea focus keeps the composer surface visually stable; no extra outer focus ring.
- Light and dark theme screenshots show the same structure, spacing, and hierarchy.

## Test Requirements

- Add renderer tests that lock the empty workspace heading behavior and ensure disabled
  placeholder sidebar/composer actions are not rendered.
- Add renderer tests that lock the selected Project heading trigger and ensure unsupported
  mode/branch labels are not rendered.
- Add renderer tests that ensure Settings does not expose unimplemented placeholder
  sections or fake config controls.
- Add a renderer test that locks the picker option set and confirms it does not include
  `不使用项目`.
- Run:
  - `pnpm --filter @scorel/app-gui typecheck`
  - `pnpm --filter @scorel/app-gui test`
  - `pnpm --filter @scorel/app-gui build`
- Run a real Electron visual smoke through CDP or Computer Use:
  - empty workspace
  - picker opened from the project pill
  - settings shell
  - dark theme using system theme or `data-theme="dark"` test override

## Impacted Files

- `apps/gui/src/renderer/styles.css`
- `apps/gui/src/renderer/shell/Sidebar.tsx`
- `apps/gui/src/renderer/workspace/EmptyState.tsx`
- `apps/gui/src/renderer/workspace/SessionView.tsx`
- `apps/gui/src/renderer/composer/ProjectPickerMenu.tsx`
- `apps/gui/src/renderer/composer/ProjectPickerPill.tsx`
- `apps/gui/src/renderer/settings/SettingsNav.tsx`
- `apps/gui/src/renderer/settings/SettingsShell.tsx`
- `apps/gui/src/renderer/settings/sections/ConfigSection.tsx`
- GUI renderer tests under `apps/gui/src/renderer/`
- `docs/ROADMAP.md`

## Risks And Boundaries

- Electron vibrancy differs by OS and accessibility settings. CSS must still provide
  readable fallback colors when vibrancy is unavailable.
- Hidden placeholder removal should not delete future roadmap intent; it only removes
  non-functional user-visible controls from the current GUI.
- The picker anchor should use DOM geometry only in the renderer. It must not introduce
  new IPC channels or main-process UI state.
