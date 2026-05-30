# WebUI Product Intent

This note captures the intended WebUI product shape after rolling back the first M5 implementation attempts. It is not an implementation spec.

## Core Idea

WebUI is a remote-only chatbox client. It should feel like Codex App / Alma, not like a dashboard, diagnostics page, or connection form.

The product hierarchy is:

```text
Device -> Project -> Session -> Chatbox
```

## Device

A remote endpoint is user-facing as a Device.

A Device has:

- `Name`: user-visible device name.
- `Link`: remote daemon WebSocket endpoint.
- `Token`: remote daemon auth token.

Devices are managed in a dedicated Settings page. The primary chat sidebar should not contain endpoint/token fields.

## Sidebar

The main sidebar should follow the Codex App / Alma interaction pattern:

- top-level actions such as New Chat, Search, Skills, Plugins, Automations
- a Projects section
- within Projects, show Device roots
- under each Device, show Projects
- under each Project, show Sessions
- a bottom Settings entry

The sidebar must not show fake projects or fake sessions.

## Sync Model

WebUI cannot embed or manage a local daemon. It only connects to remote daemons.

After a Device connects:

1. read remote identity from daemon handshake
2. sync the Project index
3. sync Session lists under each Project
4. lazy-load Session content when the user clicks a Session

Session content should not be eagerly loaded for every session.

Browser-side storage should use `localStorage` only. WebUI must not write JSONL files or daemon attach caches.

## Chatbox

Opening a Session should show a normal chatbox:

- transcript/event stream in the main area
- user/assistant/tool/status events in chronological order
- bottom composer
- send/cancel controls
- shared remote daemon session state with other clients

Settings and connection management are not the main chat surface.

## Out Of Scope For M5

- GUI / Tauri / Electron
- local daemon process manager
- account auth / OAuth / relay / NAT traversal
- IDE-style file explorer or monitoring dashboard
- full rewind/fork/compact UI
