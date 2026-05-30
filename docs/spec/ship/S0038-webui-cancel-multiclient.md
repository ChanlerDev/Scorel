# S0038: WebUI Cancel And Multi-client Share

## Goal

Wire WebUI composer Cancel to daemon `cancel` (restored in S0032), and validate that WebUI and CLI sharing the same remote daemon session see identical event streams in real time.

## Scope

- Composer Cancel button:
  - Visible only while a turn is in flight (`turn_start` received, `turn_end` not yet).
  - Click calls `client.cancel()`. Optimistic UI: button enters "cancelling…" state until daemon echoes a `turn_end` with `stopReason: "cancelled"` (or equivalent).
  - On daemon error response, surface inline error and re-enable Send.
- Cancel hotkey: `Esc` while composer is focused, mirrors button. Document behavior.
- Optimistic semantics:
  - Server-side cancellation is best-effort (S0032 acceptance criteria); UI must not pretend a turn ended until daemon confirms.
- Multi-client smoke wiring:
  - No code in this spec for the smoke itself; it's a manual validation. But add a `lib/diagnostics/connection-summary.ts` exposing `Device.id`, `remoteIdentity.deviceId`, currently subscribed `sessionId`, and last applied `streamLastSeq`. Render a dev-only debug panel under `/devices/:deviceId/projects/:projectSlug/sessions/:sessionId?debug=1` that shows this summary.
- Manual smoke (recorded in spec as the validation):
  1. Start daemon with real LLM provider.
  2. Open WebUI on the same session.
  3. Open `scorel attach --remote ws://... --session <id>` simultaneously.
  4. Send prompt from WebUI; verify CLI shows identical events.
  5. Send prompt from CLI; verify WebUI shows identical events.
  6. While a long tool call runs, click Cancel in WebUI; verify both clients receive `turn_end` with cancelled stop reason.
  7. Repeat (6) but click cancel in CLI (Ctrl-C); verify both clients receive cancelled.

## Not In Scope

- `New Chat` (S0039).
- WebUI implementation of `scorel attach`-style logs panel.
- Automated end-to-end harness (Playwright); manual is fine v1.

## Acceptance Criteria

- WebUI Cancel button appears at the right time, dispatches `cancel`, transitions UI on daemon `turn_end`.
- Esc keybind works.
- Diagnostics debug panel renders the documented summary when `?debug=1` is appended; absent otherwise.
- Manual smoke (above) passes on a real daemon + real LLM provider.
- `pnpm --filter @scorel/webui typecheck && pnpm --filter @scorel/webui test` passes.
- Repo `pnpm typecheck && pnpm test` passes.

## Tests

- Composer cancel-button visibility tests (turn_start visible, turn_end hidden, error keeps button hidden).
- Cancel dispatch test: clicking calls `client.cancel()`; daemon error response shows inline error.
- Esc hotkey test (jsdom keyboard event).
- Manual smoke: documented above.

## Affected Paths

- `apps/webui/components/chatbox/composer.tsx` (extend with Cancel)
- `apps/webui/components/chatbox/composer.test.tsx`
- `apps/webui/lib/connection/session.ts` (track `inFlight` state from turn events)
- `apps/webui/lib/diagnostics/connection-summary.ts` (new)
- `apps/webui/components/chatbox/debug-panel.tsx` (new — only mounted when `?debug=1`)
- `apps/webui/app/devices/[deviceId]/projects/[projectSlug]/sessions/[sessionId]/page.tsx` (mount debug panel conditionally)
- `docs/ROADMAP.md` (M5 step entry for S0038)
- `self/discussions/2026-05-30-webui-rebuild-brainstorm.md` (append manual smoke result note)

## Risks And Boundaries

- Cancellation race: the user may click Cancel while a `turn_end` is in flight; UI must accept the late `turn_end` and clear the cancelling state cleanly.
- Multi-tab WebUI on the same session: each tab dispatches its own cancel; daemon dedup by session id; final `turn_end` is shared.
- Debug panel must be inert in production builds — gate strictly by `?debug=1`; do not ship it on by default.
- Smoke is manual; document it precisely so the next person runs it identically.
