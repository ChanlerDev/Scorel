# S0018: Daemon Entrypoint Smoke

## Goal

Make the daemon app executable through the same direct `tsx src/index.ts ...` path used for local development.

This fixes the M3 manual lifecycle experience: `start` must actually run the daemon command, print status, and create local daemon state.

## Scope

- Add the missing direct entrypoint guard to `@scorel/app-daemon`.
- Cover the direct entrypoint path with a subprocess smoke test.
- Keep daemon lifecycle behavior unchanged.
- Move pnpm build settings out of `package.json` so modern pnpm does not print unrelated config warnings.

## Not In Scope

- Turning `scorel-daemon start` into a long-running runtime socket server.
- Remote WebSocket transport.
- Shell package installation or global binary linking.

## Acceptance Criteria

- `pnpm --filter @scorel/app-daemon exec tsx src/index.ts start` prints `scorel daemon started`.
- `pnpm --filter @scorel/app-cli exec tsx src/index.ts daemon status` sees the state written by `start`.
- `pnpm --filter @scorel/app-daemon exec tsx src/index.ts stop` clears the state.
- Direct entrypoint behavior is covered by tests.
- `pnpm typecheck && pnpm test` passes.

## Tests

- `pnpm --filter @scorel/app-daemon test`
- Manual lifecycle smoke:
  - `pnpm --filter @scorel/app-daemon exec tsx src/index.ts start`
  - `pnpm --filter @scorel/app-cli exec tsx src/index.ts daemon status`
  - `pnpm --filter @scorel/app-daemon exec tsx src/index.ts stop`
- `pnpm typecheck && pnpm test`

## Affected Paths

- `apps/daemon/src/index.ts`
- `apps/daemon/src/index.test.ts`
- `package.json`
- `pnpm-workspace.yaml`

## Risks And Boundaries

- This only fixes command execution for the current M3 lifecycle state. It does not make the daemon process stay alive as a runtime server.
