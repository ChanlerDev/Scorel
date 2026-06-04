# S0055: WebUI Composer Acceptance And Queue Strip

## Goal

Tighten the S0054 running composer behavior so the UI matches the actual daemon event model:

- focused composer controls must not show the heavy global black outline shown in browser screenshots
- send acceptance remains based on persistent events, but missing live events must recover through resync instead of hanging
- running follow-up / steer queue items are visible above the input as a small actionable stack
- project picking uses one shared Codex-like menu from both title and toolbar triggers, with a bounded scroll window and an add-project action

## Scope

- Override the global focus-visible outline inside the composer pill and keep the pill's own subtle border as the focus affordance.
- Track `queue_update` events in the WebUI projector state.
- Render queued `follow_up` / `steer` items above the textarea inside the composer, with the next item closest to the input.
- Let visible queue rows switch between follow-up / steer, return to the input for editing, or be deleted via persistent queue rewrite.
- Keep the project picker menu compact, scrollable, and wired to the existing Add Project dialog.
- If a `send_message` request completes but the matching persistent event was not observed live, trigger `resync_events` from the current anchors and resolve from the recovered persistent event.
- If send fails before acceptance, restore the input and surface `send_failed` / `disconnected` as today.

## Non-Goals

- Reordering queued items.
- Rich queue history in the transcript.
- New daemon protocol messages for queue display.
- Treating heartbeat as send acceptance. Heartbeat only proves the socket is alive; persistent event or resync proves durable session state.

## Contract

For WebUI send acceptance:

1. live matching persistent `user_message` / `queue_update` resolves the send immediately;
2. request failure rejects the send;
3. request completion without live acceptance triggers `resync_events`;
4. resync still missing the matching persistent event rejects as `send_failed`.

For queue display:

- `queue_update(queue="follow_up")` replaces the displayed follow-up stack.
- `queue_update(queue="steer")` replaces the displayed steer stack.
- Display order is stack-like: the oldest/next item is rendered closest to the textarea.
- Queue rows expose controls to convert follow-up/steer, edit back into the composer input, and delete the row.
- Convert/edit/delete are persisted by a daemon `rewrite_queue` request that appends a full `queue_update(operation="rewrite")`, matching S0052.

For project picking:

- The title and toolbar project pickers are two triggers for the same menu component.
- The menu has a bounded, scrollable project list and does not render native `select` controls.
- The menu exposes an Add Project action that opens the existing shell Add Project dialog.

## Acceptance Criteria

- The composer textarea does not draw the heavy black focus outline.
- Follow-up and steer queue items render above the textarea while a run is active.
- Follow-up and steer queue rows expose convert, edit, and delete controls.
- The project picker menu is compact, scrollable, shared by both triggers, and can open Add Project.
- A send whose matching persistent event arrives through resync resolves successfully.
- A send whose request completes but resync cannot find the matching persistent event fails instead of hanging.

## Test Requirements

- Composer tests cover no global outline class, queue strip rendering, and queue row actions.
- Empty composer and sidebar tests cover shared project picker menu scroll bounds and Add Project wiring.
- Protocol/client/daemon tests cover `rewrite_queue` appending persistent `queue_update` rewrites.
- Projector tests cover `queue_update` projection and replacement.
- Session controller tests cover request-complete resync recovery and missing-event failure.
- `pnpm typecheck` and `pnpm test` pass.
