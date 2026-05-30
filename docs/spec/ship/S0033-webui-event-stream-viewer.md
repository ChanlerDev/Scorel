# S0033: WebUI Event Stream Viewer

## Goal

Render daemon session events in the WebUI central stream.

S0033 turns WebUI from a connected shell into a live session viewer: user messages, assistant messages, streaming text deltas, tool results, and turn status become visible in the browser. Prompt sending remains out of scope until S0035.

## Scope

- Add a WebUI event projection module that consumes `ScorelEvent` values and returns UI rows.
- Render:
  - `user_message`
  - `assistant_message`
  - `tool_result`
  - `text_delta`
  - `turn_start`
  - `turn_end`
  - `error`
- Merge `text_delta` events by `eventId` into one streaming assistant row.
- Replace a streaming row with the matching persistent `assistant_message` instead of rendering a duplicate.
- Subscribe to the connected `DaemonClient` and update the central stream as events arrive.
- Render resynced events returned by S0032 connect/resync through the same projection path.

## Not In Scope

- Prompt sending or cancel.
- Project/session browser and tree controls.
- Rich markdown rendering, syntax highlighting, images, file attachments, or diff views.
- Tool-call expansion UI beyond a compact tool result row.
- Rewind/fork/compact controls.

## Acceptance Criteria

- WebUI event projection renders user, assistant, tool result, streaming, turn status, and error rows.
- Streaming text deltas with the same `eventId` merge into one row.
- A final persistent assistant message replaces the matching streaming row.
- Connected WebUI subscribes to `DaemonClient` events and updates `[data-event-stream]`.
- Resynced events returned by `client.resync()` render into the same stream.
- Existing S0030-S0032 tests still pass.
- `pnpm --filter @scorel/app-webui build` passes.
- `pnpm --filter @scorel/app-webui typecheck` passes.
- `pnpm --filter @scorel/app-webui test` passes.
- `pnpm typecheck && pnpm test` passes.

## Tests

- Add event projection tests for:
  - persistent user/assistant/tool rows
  - text delta merge
  - final assistant replacing streaming row
  - turn/error status rows
- Add WebUI controller/mount tests proving resync and live subscribed events render.
- Run WebUI build/typecheck/test.
- Run full repo verification.
- Run local browser smoke for the event stream container.

## Affected Paths

- `docs/ROADMAP.md`
- `docs/spec/ship/S0033-webui-event-stream-viewer.md`
- `apps/webui/src/app.ts`
- `apps/webui/src/app.test.ts`
- `apps/webui/src/shell.ts`
- `apps/webui/src/remote-session.ts`
- `apps/webui/src/remote-session.test.ts`
- `apps/webui/src/event-stream.ts`
- `apps/webui/src/event-stream.test.ts`

## Risks And Boundaries

- Client-side projection is UI-only. It must not become authoritative session state or context-building logic.
- Streaming text is provisional. Final persistent assistant messages are the durable view and must replace matching transient rows.
- Keep rendering plain text for now. Rich markdown/diff rendering belongs in later UI polish.
