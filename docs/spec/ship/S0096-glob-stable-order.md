# S0096: Glob Stable Order

## Goal

Make the `Glob` tool return deterministic results across local macOS and Linux CI.

## Scope

- Sort `Glob` file results by workspace-relative path before applying `head_limit` / `offset`.
- Preserve existing `Grep` behavior and pagination shape.

## Not In Scope

- Changing ripgrep invocation.
- Changing Grep content/count ordering.

## Acceptance Criteria

- `Glob` result limiting does not depend on filesystem or ripgrep output order.
- Existing coding tool tests pass on Linux and macOS.

## Test Requirements

```bash
pnpm --filter @scorel/core test -- src/tools/coding-tools.test.ts
pnpm typecheck
pnpm test
```

## Status

Done.
