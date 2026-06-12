# S0092: IM Message Media And Human Cadence

## Goal

Make IM conversations feel alive and trustworthy by improving outgoing message capability and IM-specific response cadence.

The business value is user confidence. In IM, silence for minutes reads as failure; Scorel needs visible progress and short human-style replies without compromising the existing agent loop.

## Scope

### SendChannelMessage Payload

Extend `SendChannelMessage` from text-only to a structured outgoing message:

```ts
type SendChannelMessageInput = {
  text?: string;
  attachments?: Array<{
    type: "image" | "file";
    path?: string;
    url?: string;
    mimeType?: string;
    caption?: string;
  }>;
  channel?: string;
  target?: "current";
};
```

Rules:

- At least one of `text` or `attachments` is required.
- Adapters may downgrade unsupported attachments to a clear tool error.
- Local file paths must be explicit and must not be guessed from raw platform ids.
- Tool result details report per-attachment status.

### Adapter Capability Contract

- Add optional adapter capabilities for outgoing attachment support.
- Telegram/QQ/WeChat can initially support text and explicitly reject unsupported media.
- Loopback should support structured capture of text and attachment metadata for tests.

### IM System Prompt / Harness Guidance

Add IM-specific guidance to channel context:

- acknowledge quickly when work will take time;
- send brief progress updates through `SendChannelMessage` during long tasks;
- prefer concise, conversational wording;
- do not wait until every tool finishes before sending any reply;
- avoid exposing internal tool names unless useful to the user;
- keep business-critical facts and file references precise.

This guidance must enter through the existing channel harness item / skill path, not a second provider-level system prompt.

## Not In Scope

- Full media upload implementation for every platform.
- Voice, stickers, albums, interactive buttons, or payments.
- Cross-conversation proactive messages.
- A new IM runtime loop or queue.
- Fake progress timers outside the agent loop.

## Acceptance Criteria

- `SendChannelMessage` accepts text, image, and file attachment metadata.
- Text-only calls remain backward compatible.
- Unsupported attachment sends fail as tool errors, not silent no-ops.
- IM channel reminders tell the agent to respond early and keep long-running users informed.
- Built-in IM skills include platform-specific response cadence guidance.
- Tests prove the model-facing tool schema rejects empty sends and preserves attachment metadata.

## Testing Requirements

- Core channel tool tests for structured payload parsing.
- Loopback adapter tests for captured attachment metadata.
- Telegram/QQ/WeChat tests for unsupported media errors or implemented send mapping.
- Instruction/channel context tests for IM cadence guidance.
- Full `pnpm typecheck && pnpm test`.

## Status

Done.
