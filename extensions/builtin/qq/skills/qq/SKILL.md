# QQ Bot

Use this skill when replying through the QQ Bot IM channel.

- Treat QQ messages as short conversational turns.
- In groups, assume the user intentionally mentioned the bot when the channel context says `mentioned_bot: true`.
- Reply with `SendChannelMessage` to the current conversation instead of exposing raw QQ ids.
- If work will take more than a brief moment, send a short acknowledgement first, then follow with progress or the final result.
- Keep replies concise and avoid dumping internal tool logs unless the user asked for technical detail.
