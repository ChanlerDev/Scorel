# S0054: WebUI Running Message Behavior

## Goal

Make WebUI message sending match Codex-style running behavior:

- idle sends clear once the daemon's persistent event stream confirms the user message, not when the assistant finishes
- while a run is active, the composer remains editable
- running sends can either queue a follow-up or steer the active run
- users can choose the default running behavior in Settings
- `Command+Enter` sends with the default behavior, while `Command+Shift+Enter` sends the opposite behavior

## Scope

- Extend the protocol `send_message` options with explicit running behavior: `follow_up` or `steer`.
- Preserve existing CLI/client request semantics: `send_message` responses remain completion/queue responses, not accepted acknowledgements.
- Let WebUI clear the composer from the canonical persistent event stream instead of a second request-level accepted acknowledgement.
- Add WebUI settings storage for default running behavior.
- Update the session composer so Enter inserts a newline, `Command+Enter` sends, and `Command+Shift+Enter` sends the opposite running behavior.
- Show both send and cancel controls while a run is active.

## Non-Goals

- Full queue editing UI.
- Deleting queued follow-ups.
- Rich steer/follow-up transcript controls beyond existing event rendering.
- Changing CLI input behavior.

## Contract

`send_message` defaults remain compatible:

- idle requests resolve after the user turn completes
- no `runningBehavior` option while a run is active means `follow_up`

WebUI submits:

```ts
options: {
  runningBehavior: "follow_up" | "steer"
}
```

WebUI treats daemon acceptance as confirmed when it observes the matching persistent event:

- idle: the daemon has appended and broadcast the source `user_message`
- running + follow-up: the daemon has appended the `queue_update` for `follow_up`
- running + steer: the daemon has appended the `queue_update` for `steer`

`send_message` responses resolve when:

- idle: the user turn finishes
- running + follow-up: the queued follow-up is consumed and finishes
- running + steer: the steer queue item is accepted and queued; it does not create a user turn

## Acceptance Criteria

- WebUI composer clears and becomes editable after the matching persistent `user_message` or `queue_update`, before assistant completion.
- While `inFlight`, users can type another message.
- While `inFlight`, normal send uses the configured default behavior.
- While `inFlight`, `Command+Shift+Enter` sends the opposite behavior.
- Settings exposes a persistent default running behavior selector.
- Follow-up sends append `queue_update(queue="follow_up")`.
- Steer sends append `queue_update(queue="steer")` and is later consumed into a `harness_item kind="steer"`.
- `pnpm typecheck` and `pnpm test` pass.

## Test Requirements

- Protocol round-trip covers the new send options and response shapes.
- Daemon tests cover durable persistent acceptance for idle sends, follow-up queue, and steer queue.
- WebUI composer tests cover editable in-flight input, `Command+Enter`, `Command+Shift+Enter`, send+cancel controls, and early clear.
- Settings store tests cover default behavior persistence.
