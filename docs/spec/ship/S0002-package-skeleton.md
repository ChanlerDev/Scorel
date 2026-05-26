# S0002: Package Skeleton

## Goal

Create the final package and app skeleton for the clean Scorel rewrite.

## Scope

- Create `packages/protocol`.
- Create `packages/core`.
- Create `packages/daemon`.
- Create `packages/client`.
- Create `apps/cli`.
- Create `apps/daemon`.
- Add minimal package manifests, tsconfigs, source entrypoints, and smoke tests.
- Keep dependency direction aligned with ADR-004.

## Not In Scope

- No protocol event definitions beyond minimal placeholders.
- No runtime loop.
- No daemon behavior.
- No CLI chat behavior.
- No WebUI / GUI.

## Acceptance Criteria

- [ ] `pnpm -r typecheck` passes.
- [ ] `pnpm -r test` passes.
- [ ] Every package has a minimal public export.
- [ ] `@scorel/client` does not depend on `@scorel/core` or `@scorel/daemon`.
- [ ] `@scorel/daemon` does not depend on `@scorel/client`.
- [ ] `apps/cli` and `apps/daemon` are entrypoint shells only.

## Test Requirements

- Add import smoke tests for each package.
- Add a simple dependency-boundary test or document manual `package.json` inspection.

## Affected Paths

- `packages/protocol/`
- `packages/core/`
- `packages/daemon/`
- `packages/client/`
- `apps/cli/`
- `apps/daemon/`
- `pnpm-workspace.yaml`
- root `package.json`

## Risks

- Adding behavior in this spec will blur the foundation. Keep it skeleton-only.
