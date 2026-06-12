# S0093: GUI IM Settings Platform Layout

## Goal

Redesign GUI IM Settings so multiple platforms fit without crowding the page.

The business value is scale. Telegram was one provider; Telegram + QQ + WeChat needs a repeatable platform row pattern where details expand only when the user asks.

## Scope

- Replace the current Telegram-only large form with a platform list.
- Each platform row shows:
  - platform name;
  - enabled/disabled toggle;
  - active/inactive status;
  - concise credential/config summary;
  - expand/collapse affordance.
- Clicking a row expands its detailed config below that row.
- Support Telegram, QQ, and WeChat using one reusable component shape.
- Preserve existing Telegram config fields and persistence behavior.
- Add QQ and WeChat config fields that match S0091.
- Keep settings stored through the existing `getExtensionSettings` / `upsertExtensionSettings` IPC path.

## Not In Scope

- Remote Relay IM settings.
- Diagnostics timeline.
- Live credential validation beyond existing adapter refresh behavior.
- Account OAuth or QR login.

## Acceptance Criteria

- The IM Settings page renders three compact platform rows.
- No single disabled platform consumes a full settings page height.
- Expanding Telegram reveals the existing credential/poll/allow-list fields.
- Expanding QQ or WeChat reveals their S0091 config fields.
- Toggling a platform writes the correct extension config and refreshes local Host IM extensions.
- Direct secret fields are password inputs and are never displayed in summaries.
- Layout remains readable in narrow GUI widths.

## Testing Requirements

- GUI render tests for compact rows and expansion.
- GUI interaction tests for toggling and field blur persistence.
- Existing Telegram settings behavior remains covered.
- Full `pnpm typecheck && pnpm test`.

## Status

Planned.
