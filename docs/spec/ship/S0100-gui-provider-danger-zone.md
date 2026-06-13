# S0100: GUI Provider Danger Zone Placement

## Goal

Move destructive Provider management actions out of the primary Provider edit form, so normal configuration fields remain the first visual focus and deletion is clearly presented as a secondary dangerous action.

S0101 supersedes the final placement: `删除提供商` now lives in the Provider configuration block's lower-right action area instead of a bottom danger row.

## Scope

- In GUI Settings -> Provider:
  - this spec recorded the first placement pass;
  - S0101 defines the current placement in the Provider configuration block;
  - keep the existing `removeModelProvider` behavior unchanged.
- Add rendering coverage that verifies the destructive action is below normal model-management controls.

## Not In Scope

- Changing Provider deletion semantics, confirmation behavior, or daemon/client APIs.
- Redesigning the Provider page layout beyond the destructive-action placement.
- Changing model catalog, model selection, or provider form fields.

## Acceptance Criteria

- Current acceptance is governed by S0101: `删除提供商` appears in the Provider configuration block.
- Existing Provider add/edit/model actions remain unchanged.
- GUI rendering tests cover the current placement.

## Test Requirements

```bash
pnpm --filter @scorel/app-gui test -- src/renderer/gui-shell.test.tsx
pnpm --filter @scorel/app-gui typecheck
```

Manual:

- Start the GUI with a Project that has a configured Provider.
- Open Settings -> Provider.
- Confirm S0101 current behavior: the delete button appears in the Provider configuration block's lower-right action area.

## Impacted Files

- `apps/gui/src/renderer/settings/sections/ProviderSection.tsx`
- `apps/gui/src/renderer/styles.css`
- `apps/gui/src/renderer/gui-shell.test.tsx`
- `docs/CHANGELOG.md`
- `docs/ROADMAP.md`

## Risks And Boundaries

- The delete action remains destructive and immediate, matching existing behavior. This spec only changes placement.
- The danger row should not introduce another card nested inside the Provider card; it stays as an inline separated row.

## Status

Done.
