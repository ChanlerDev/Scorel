# S0017: Grep Files Output Mode

## Goal

Simplify the `Grep` tool `output_mode` contract to the obvious `files` mode for matching file paths.

This is a product-facing tool schema fix: agents should be able to ask for matching file paths with the obvious word `files`.

## Scope

- Change `Grep` schema to accept `files`, `content`, and `count`.
- Change the default `Grep` mode to `files`.
- Update `Grep` runtime details to report `mode: "files"`.
- Update tool documentation that names the old mode.
- Keep the ripgrep-backed behavior and pagination unchanged.

## Not In Scope

- Compatibility aliases for old or alternative names.
- New search modes.
- Broader provider schema description work.
- Claude Code parity for every `Grep` parameter.

## Acceptance Criteria

- `Grep` with `output_mode: "files"` returns matching file paths.
- `Grep` defaults to file-path output when `output_mode` is omitted.
- Unknown `output_mode` values are rejected with a concise validation error.
- The provider schema exposes `files`.
- `pnpm --filter @scorel/core test -- tools` passes.
- `pnpm typecheck && pnpm test` passes.

## Tests

- `pnpm --filter @scorel/core test -- tools`
- `pnpm typecheck && pnpm test`

## Affected Paths

- `packages/core/src/tools/coding-tools.ts`
- `packages/core/src/tools/coding-tools.test.ts`
- `packages/core/src/provider/pi-ai.ts`
- `docs/spec/tools.md`
- `docs/spec/ship/S0012-coding-tools-maturity.md`

## Risks And Boundaries

- This intentionally keeps the public tool contract small before Scorel has a stable public tool API.
- Existing session replays containing old tool calls may show the old error if re-executed; historical event display remains unaffected.
