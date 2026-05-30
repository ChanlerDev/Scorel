# S0031: WebUI Information Architecture

## Goal

Turn the S0030 WebUI baseline from a bare remote-connect form into the first product-shaped WebUI shell.

S0031 establishes the visual and information architecture for M5: a Codex App / Alma inspired browser interface with a left project/session sidebar, a central session stream, and a bottom composer. It remains a thin Web client over `@scorel/client`; real session browsing, event streaming, prompt sending, and cancel behavior are left to later M5 specs.

## Scope

- Replace the minimal one-column connection screen with a stable three-part WebUI shell:
  - left sidebar for projects, sessions, and remote connection status
  - central session surface for messages/events and empty-state guidance
  - bottom composer for prompt text, future tool/model controls, and send/cancel affordances
- Keep the remote endpoint/token/session form available as a compact connection panel in the sidebar.
- Add sample/static project and session rows only as UI placeholders; do not read real session index yet.
- Add sample/static event rows only as visual scaffolding; do not subscribe to daemon events yet.
- Add CSS in the app bundle with a low-noise macOS-like light theme:
  - muted sidebar
  - white central canvas
  - rounded panels
  - subtle borders/shadows
  - responsive collapse for narrow screens
- Preserve S0030 connection wiring through `connectToRemoteSession`.

## Not In Scope

- Real project/session listing from `project-index.json` or daemon lookup.
- Real event stream rendering from `DaemonClient.subscribe()`.
- Prompt sending, cancel, model switching, tool execution, file upload, or permission controls.
- GUI, Tauri, Electron, native titlebar behavior, or local daemon process management.
- Dark theme, user theming, design system extraction, or external UI libraries.

## Acceptance Criteria

- WebUI renders a left sidebar with project/session placeholder sections and remote connection status.
- WebUI renders a central session stream surface with an empty-state/message scaffold.
- WebUI renders a bottom composer with prompt input, tool/model placeholders, and send/cancel affordances.
- WebUI copy and layout reference Scorel product language, not generic dashboard wording.
- CSS is bundled through the WebUI TypeScript entrypoint and includes responsive layout rules.
- Existing S0030 remote connect form still calls `connectToRemoteSession`.
- Unit tests cover shell structure and copy without requiring a browser DOM implementation.
- Browser-safety and package-boundary tests still pass.
- `pnpm --filter @scorel/app-webui build` passes.
- `pnpm --filter @scorel/app-webui typecheck` passes.
- `pnpm --filter @scorel/app-webui test` passes.
- `pnpm typecheck && pnpm test` passes.

## Tests

- Add WebUI shell render tests for:
  - sidebar/project/session structure
  - central session stream structure
  - composer structure
  - injected CSS markers and responsive rule
- Keep S0030 connector tests.
- Run WebUI build/typecheck/test.
- Run full repo verification.
- Run a local browser smoke to confirm the built page loads and exposes the main UI sections.

## Affected Paths

- `docs/ROADMAP.md`
- `docs/spec/ship/S0031-webui-information-architecture.md`
- `apps/webui/src/app.ts`
- `apps/webui/src/app.test.ts`
- `apps/webui/src/shell.ts`
- `apps/webui/src/browser-safety.test.ts`

## Risks And Boundaries

- UI placeholders can be mistaken for real product data. Label connection/session scaffolding clearly and keep real data loading in S0032/S0034.
- Styling can become a design-system detour. Keep this as one focused shell stylesheet until repeated components justify extraction.
- Do not copy Codex App / Alma implementation details or assets. Reuse the information architecture and interaction shape: sidebar, session stream, composer, and low-noise macOS feel.
