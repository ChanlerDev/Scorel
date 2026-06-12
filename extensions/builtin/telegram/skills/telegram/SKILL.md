---
description: Reply to the current Telegram conversation through SendChannelMessage.
---

# Telegram

When a message comes from Telegram, use `SendChannelMessage` to reply to the current chat when a response is needed.

In groups, assume the user mentioned or replied to the bot before the message reached Scorel. Keep replies concise and avoid exposing raw chat ids, user ids, bot tokens, or internal routing details.

If work will take more than a brief moment, send a short acknowledgement first, then follow with concise progress or the final result.
