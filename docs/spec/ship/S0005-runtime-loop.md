# S0005: Runtime Loop

## Goal

Implement a minimal runtime loop that can turn a prepared context into a stream of assistant runtime events without owning session state.

## Deliverable

- `ScorelRuntime.executeTurn(context, systemPrompt, options)`.
- Raw runtime event stream for turn start/end, text delta, message end, and error.
- Provider adapter seam that supports a deterministic fake provider in tests.
- Minimal tool loop support only if required to satisfy M1's "LLM + tool loop" criterion.
- Runtime cancel signal handling that stops generation without corrupting persisted session state.

## Success Criteria

- Runtime accepts context as input and does not read or write JSONL.
- Runtime emits ordered raw events that RuntimeBridge can later convert to protocol events.
- Fake provider tests can simulate streaming, completion, provider error, and cancellation.
- No app, daemon, or client code is needed to test runtime behavior.

## Boundaries

- No daemon persistence.
- No RuntimeBridge implementation.
- No MCP loading.
- No permission policy.
- No parallel tool execution.
- No steer/followUp queues.
- No provider-specific behavior in tests that would require API keys.

## Verification

- `pnpm --filter @scorel/core test -- runtime`
- Unit tests assert raw event ordering for success, error, and cancel.
- Fake provider/fake tool tests cover the minimum M1 tool loop.
- `pnpm -r typecheck`

## Affected Paths

- `packages/core/src/runtime/`
- `packages/core/src/tools/`
- `packages/protocol/src/`

## Risks

- Pulling persistence into runtime would violate the core architecture. Runtime must stay a pure execution engine.
- Depending on a real provider in CI would make tests flaky and block contributors without credentials.
