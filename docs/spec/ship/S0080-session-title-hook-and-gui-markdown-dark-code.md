# S0080: Session Title Hook And GUI Markdown Dark Code

## Goal

Move automatic session title generation into a general session lifecycle hook and
fix GUI Markdown code block colors in dark mode.

## Scope

- Schedule title generation from an `afterUserMessage` lifecycle hook after the
  first `user_message` has been persisted.
- Keep title generation on the configured `auxiliary` model.
- Keep title generation off the main assistant response path: it starts after
  the first user message persists and must not wait for the assistant answer.
- Preserve the existing persistent `session_title_updated` event contract.
- Use a dark Shiki theme for GUI fenced Markdown code blocks.

## Non-goals

- Add manual rename UI.
- Add user-visible title regeneration controls.
- Build a full public extension runtime.
- Change WebUI Markdown rendering.

## Acceptance Criteria

- `#runUserTurn` does not directly call the title generator.
- The lifecycle hook is scheduled after the first user message is appended and
  before the assistant runtime turn starts.
- The lifecycle hook can run concurrently with the assistant runtime, while
  persistent JSONL appends remain serialized.
- The title prompt uses a dedicated system prompt and a wrapped user request so
  the auxiliary model summarizes the request instead of answering it.
- The title hook still selects role `auxiliary`.
- GUI Markdown fenced code blocks no longer use the light GitHub Shiki theme.

## Tests

- Daemon tests cover the session lifecycle hook structure.
- Existing embedded daemon tests still cover auxiliary title generation.
- GUI tests cover dark Shiki theme selection.
- `pnpm typecheck && pnpm test` passes.

## Impacted Files

- `packages/daemon/src/index.ts`
- `packages/daemon/src/session-hooks.test.ts`
- `apps/gui/src/renderer/chatbox/ShikiCodeBlock.tsx`
- `apps/gui/src/shiki-theme.test.ts`
- `docs/ROADMAP.md`

## Risks

- The title generation hook must not block the assistant turn.
- The title generation hook must not append events concurrently with the runtime
  loop in a way that corrupts JSONL order or sequence numbers.
- Dark Shiki tokens must not override the app's inline code styling outside
  fenced code blocks.
