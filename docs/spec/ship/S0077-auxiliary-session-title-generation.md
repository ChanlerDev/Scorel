# S0077: Auxiliary Session Title Generation

## Goal

Generate a useful session title after the first chat message without blocking the
main assistant turn.

The title pipeline should use the configured `auxiliary` model so small metadata work
does not consume the user's primary/standard working model.

## Scope

### 1. Persistent title event

Add a persistent metadata event:

- `type`: `session_title_updated`;
- `title`: sanitized generated or user-provided title;
- `source`: `model` or `user`;
- optional `model`: selected model summary used by model generation;
- optional `derivedFrom`: event id and seq that the title was derived from.

The event is not part of the conversation tree and must not render as a chat turn.
Session summaries use the latest `session_title_updated.title`, then fall back to
`session_header.meta.title`, then the session id.

The event is intentionally reusable for future manual rename UX. V1 only implements
`source: "model"`.

### 2. Auxiliary model title generation

After the first user message in a session:

- if the session has no explicit header title and no prior title update event;
- start a sidecar title generation task using role `auxiliary`;
- do not block the main assistant runtime turn;
- append `session_title_updated` when generation succeeds;
- write diagnostics only when generation fails.

The title prompt uses only the first user message text and a small system prompt. It
must not use the full conversation context.

Title generation runtime must not register coding tools.

### 3. GUI/WebUI/session summary projection

Session lists and top bars should pick up title update events through existing event
streams and summary refresh paths. Transcript projectors ignore the event.

## Not In Scope

- Manual rename UI.
- Title regeneration controls.
- Deleting title history.
- Streaming title generation tokens.
- Blocking session creation or first assistant turn on title generation.

## Acceptance Criteria

- A first user message with no existing title can append `session_title_updated`.
- Title generation uses the `auxiliary` role selection.
- Explicit `CreateSessionMeta.title` suppresses automatic title generation.
- Existing title update events suppress duplicate model generation.
- Session summaries prefer the latest title update event.
- GUI/WebUI transcript projectors ignore title metadata events.
- Future manual rename can use the same event type with `source: "user"`.

## Test Requirements

- Protocol tests cover the new persistent event shape.
- Session store tests cover append/load validation for title events.
- Daemon embedded tests cover first-message auxiliary title generation and explicit-title suppression.
- Session summary tests cover latest title event wins.
- GUI/WebUI projector tests cover ignoring title metadata events.
- Run focused tests plus `pnpm typecheck && pnpm test`.

## Impacted Files

- `packages/protocol/src/events.ts`
- `packages/protocol/src/index.test.ts`
- `packages/core/src/session/index.ts`
- `packages/core/src/session/session.test.ts`
- `packages/daemon/src/index.ts`
- `packages/daemon/src/embedded/embedded.test.ts`
- `packages/daemon/src/projects/sessions.ts`
- `apps/gui/src/renderer/chatbox/projector.ts`
- `apps/webui/lib/events/projector.ts`
- `docs/ROADMAP.md`

## Risks And Boundaries

- Title generation appends a persistent metadata event, so `currentSeq` advances.
- V1 should not update summary sort order solely because a model generated a title.
- If auxiliary model config is missing or invalid, the chat should continue and only a
  diagnostic should be written.
