# S0100: GUI Provider Danger Zone Placement

## Goal

Move destructive Provider management actions out of the primary Provider edit form, so normal configuration fields remain the first visual focus and deletion is clearly presented as a secondary dangerous action.

## Scope

- In GUI Settings -> Provider:
  - remove the `删除提供商` button from the top of the Provider detail panel;
  - add a bottom `危险操作` row after the model catalog and manual model section;
  - keep the existing `removeModelProvider` behavior unchanged.
- Add rendering coverage that verifies the destructive action is below normal model-management controls.

## Not In Scope

- Changing Provider deletion semantics, confirmation behavior, or daemon/client APIs.
- Redesigning the Provider page layout beyond the destructive-action placement.
- Changing model catalog, model selection, or provider form fields.

## Acceptance Criteria

- Provider settings no longer show `删除提供商` before the main Provider form.
- `删除提供商` appears in a visually separated `危险操作` row near the bottom of the Provider detail.
- Existing Provider add/edit/model actions remain unchanged.
- GUI rendering tests cover the new placement.

## Test Requirements

```bash
pnpm --filter @scorel/app-gui test -- src/renderer/gui-shell.test.tsx
pnpm --filter @scorel/app-gui typecheck
```

Manual:

- Start the GUI with a Project that has a configured Provider.
- Open Settings -> Provider.
- Confirm the delete button appears in the bottom danger row instead of the top of the edit form.

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
