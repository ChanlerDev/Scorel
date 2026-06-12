# S0088: GUI Streaming Thinking Contract

## Goal

Make thinking visible while a turn is running instead of inserting the thinking block only after the final persistent `assistant_message` arrives.

The business value is process trust. Users should see the agent's work unfold in order, not as a post-hoc replay after the visible answer has already completed.

## Context

Today Scorel streams only `text_delta`. Thinking content exists in the final persistent assistant message, so GUI can only render it after the turn is finalized. A GUI-only placeholder would be misleading because it would imply thinking is streaming when the runtime has not emitted it.

## Candidate Scope

- Add a protocol/runtime event for streaming thinking, likely `thinking_delta` or a more general ordered `content_delta`.
- Preserve ordered assistant content blocks so thinking, text, and tool calls reconcile cleanly with the final persistent assistant message.
- Update GUI projector to create and update thinking parts incrementally.
- Keep final `assistant_message` as authoritative reconciliation, not a second visual insertion.

## Not In Scope

- Tool block visual polish; covered by `S0087`.
- Fake GUI placeholders for thinking content.
- Changing provider reasoning semantics beyond the event stream needed to display already-produced thinking.

## Acceptance Criteria

- Thinking appears during the active turn when the provider/runtime emits thinking content.
- Final assistant reconciliation does not duplicate or reorder thinking/text/tool parts.
- Existing text streaming remains smooth.
- Protocol, daemon/client, GUI projector, and tests all agree on the new event contract.

## Status

Planned.
