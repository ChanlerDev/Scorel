# S0002: Package Skeleton

## Goal

Create the final workspace skeleton so every later M1 implementation has the correct package boundary from day one.

## Deliverable

- Create `packages/protocol`.
- Create `packages/core`.
- Create `packages/daemon`.
- Create `packages/client`.
- Create `apps/cli`.
- Create `apps/daemon`.
- Add minimal package manifests, tsconfigs, source entrypoints, and smoke tests.
- Keep dependency direction aligned with ADR-004.

## Success Criteria

- Every package has a minimal public export.
- Every package has an import smoke test.
- `@scorel/protocol` has no internal package dependency.
- `@scorel/core` depends on `@scorel/protocol`, not on daemon/client/apps.
- `@scorel/daemon` may depend on protocol/core, not on client/apps.
- `@scorel/client` depends on protocol only.
- `apps/cli` and `apps/daemon` are entrypoint shells only.

## Boundaries

- No protocol event definitions beyond minimal placeholders.
- No runtime loop.
- No daemon behavior.
- No CLI chat behavior.
- No WebUI / GUI.

## Verification

- `pnpm -r typecheck`
- `pnpm -r test`
- Dependency-boundary smoke test or explicit package manifest inspection.

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
- If package exports are too clever now, later specs will inherit accidental API shape. Use minimal exports.
