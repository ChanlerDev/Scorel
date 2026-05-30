# S0037: WebUI Device Settings And Session Tree

## Goal

Correct the M5 WebUI information architecture so it matches a Codex App style chat product:

```text
Settings page -> add Device(Name, Link, Token)
Sidebar -> Device -> Project -> Session
Session -> Chatbox
```

S0036 introduced remote persistence and project/session sync, but its visible UI still put connection controls directly in the primary sidebar and showed remotes as a separate rail. That is not the intended product shape. A remote is a user-configured device. Devices are managed in Settings; the main navigation presents the user's devices, projects, and sessions.

## Scope

- Rename the user-facing concept from Remote to Device in WebUI copy.
- Move device configuration into a dedicated Settings page:
  - Device name
  - Link
  - Token
  - Save/connect action
- Remove the separate remote rail and inline remote settings card from the chat sidebar.
- Render the main sidebar as:
  - primary actions: New Chat, Search, Skills, Plugins, Automations
  - `Projects` section containing Device -> Project -> Session hierarchy
  - bottom Settings entry
- Keep `localStorage` persistence from S0036.
- Keep remote-only connect/sync behavior:
  - connect selected device
  - sync projects first
  - sync sessions under projects
  - lazy-load session content when a session is selected
- Keep the main area as a normal chatbox:
  - empty state before session selection
  - transcript/event stream after selection
  - bottom composer

## Not In Scope

- GUI / Tauri / Electron.
- Multi-project backend beyond current daemon `projectSlug`.
- Account system, OAuth, relay, TLS provisioning.
- Full session prefetch.
- Editing/removing devices.
- New chat creation flow.

## Acceptance Criteria

- Shell has a dedicated Settings page with device form fields: Name, Link, Token.
- Main sidebar does not contain endpoint/token fields.
- Main sidebar renders Device -> Project -> Session hierarchy.
- A saved/connected device appears as the root node in the tree.
- Projects render under their device.
- Sessions render under their project.
- Clicking a session opens/loads that session and enables chatbox controls.
- Empty chat state is normal chatbox copy, not diagnostics/dashboard copy.
- No fake project/session rows are hard-coded.
- `pnpm --filter @scorel/app-webui build` passes.
- `pnpm --filter @scorel/app-webui typecheck` passes.
- `pnpm --filter @scorel/app-webui test` passes.
- `pnpm typecheck && pnpm test` passes.
- Browser smoke confirms Settings and Device -> Project -> Session layout.

## Tests

- Shell tests assert:
  - no separate remote rail
  - Settings page exists
  - sidebar has Settings entry
  - sidebar has `data-device-tree`
  - device config fields are only in Settings
- Rendering tests assert Device -> Project -> Session hierarchy is escaped and ordered.
- App/controller tests continue to cover remote connect, project/session sync, lazy session load, prompt, and cancel.
- Full repo check remains green.

## Affected Paths

- `docs/ROADMAP.md`
- `docs/spec/ship/S0037-webui-device-settings-tree.md`
- `apps/webui/src/shell.ts`
- `apps/webui/src/app.ts`
- `apps/webui/src/app.test.ts`
- `apps/webui/src/session-browser.ts`
- `apps/webui/src/session-browser.test.ts`

## Risks And Boundaries

- Internal code may still use `RemoteProfile` names from S0036 to avoid churn; S0037 only corrects the user-facing product language and UI hierarchy.
- Device credentials are still stored in browser `localStorage`; this is acceptable for M5 and must not be logged or rendered outside Settings form fields.
