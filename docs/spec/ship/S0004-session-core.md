# S0004: Session Core

## Goal

Make conversation history a recoverable asset by implementing append-only JSONL v1 storage, replay, tree construction, and context building.

## Deliverable

- Session create/load APIs.
- Append-only JSONL writer and reader.
- `SessionHeader` handling.
- Persistent event append with stable `seq`, `parentId`, and timestamps.
- `SessionTree` replay from JSONL.
- `buildContext(tree, leafId)` for M1 message events.
- Resume support for the latest active leaf.

## Success Criteria

- A session can be created, appended to, closed, loaded again, and replayed to the same tree.
- Context building produces the expected LLM message sequence for a linear M1 conversation.
- Invalid or partial JSONL fails predictably with typed errors.
- Session code lives in `@scorel/core` and depends only on `@scorel/protocol` plus allowed runtime dependencies.

## Boundaries

- No file checkpoint.
- No compact implementation.
- No rewind or branch UX.
- No clone.
- No schema migration; this is the first clean JSONL version.
- No daemon ownership rules here. Daemon will be the only writer in S0006.

## Verification

- `pnpm --filter @scorel/core test -- session`
- Unit tests cover create, append, reload, replay, leaf path, and context building.
- Error tests cover missing header, invalid JSON line, duplicate event id, invalid parent, and non-monotonic seq.
- `pnpm -r typecheck`

## Affected Paths

- `packages/core/src/session/`
- `packages/core/src/events/`
- `packages/protocol/src/`

## Risks

- If session APIs expose mutable internals, daemon/client boundaries will be harder to enforce later.
- If buildContext starts handling future event types now, M1 becomes harder to test. Use explicit M1 handlers only.
