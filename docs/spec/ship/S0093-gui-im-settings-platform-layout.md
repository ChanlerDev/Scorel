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
- Clicking the expanded row again collapses it.
- The page defaults to all platforms collapsed unless a previous expanded platform is stored locally.
- The last expanded platform is remembered locally; collapsing clears that remembered state.
- Support Telegram, QQ, and WeChat using one reusable component shape.
- Preserve existing Telegram config fields and persistence behavior.
- Add QQ and WeChat config fields that match S0091/S0094.
- For QQ and WeChat, expose the current quick setup fields only: QQ `App ID` / `App Secret`, WeChat `Outbound Webhook` plus inbound callback `Callback Token` / `Callback Host` / `Callback Port`.
- Keep settings stored through the existing `getExtensionSettings` / `upsertExtensionSettings` IPC path.
- Absorb immediate GUI review fixes found before push:
  - expanded platform details must have a visible ownership boundary;
  - the composer must not submit while an IME composition is active.

## Not In Scope

- Remote Relay IM settings.
- Diagnostics timeline.
- Live credential validation beyond existing adapter refresh behavior.
- Account OAuth or QR login.

## Acceptance Criteria

- The IM Settings page renders three compact platform rows.
- The first render does not expand Telegram by default.
- No single disabled platform consumes a full settings page height.
- Expanding Telegram reveals the existing credential/poll/allow-list fields.
- Expanding QQ or WeChat reveals their S0091 config fields.
- QQ and WeChat do not expose env-var-first credential fields in the default Settings flow.
- Re-clicking the expanded platform collapses details.
- Re-opening IM Settings restores the previously expanded platform when one was stored.
- Toggling a platform writes the correct extension config and refreshes local Host IM extensions.
- Direct secret fields are password inputs and are never displayed in summaries.
- Layout remains readable in narrow GUI widths.
- Expanded fields are visually grouped under the active platform, not blended into sibling platform rows.
- Pressing Enter while Chinese/Japanese/Korean IME composition is active does not submit or block candidate selection.
- Plain Enter still submits when enabled; Shift+Enter remains available for newline input.

## Testing Requirements

- GUI render tests for compact rows and expansion.
- GUI interaction tests for default-collapsed, toggle-to-collapse, and stored expansion restore.
- GUI interaction tests for toggling and field blur persistence.
- Existing Telegram settings behavior remains covered.
- GUI composer tests cover IME composition Enter, plain Enter, and Shift+Enter.
- Full `pnpm typecheck && pnpm test`.

## Status

Done.
