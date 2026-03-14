---
tracker:
  kind: linear
  api_key: $LINEAR_API_KEY
  project_slug: prosel-the-prose-system-5d795b228b00
  active_states:
    - Todo
    - In Progress
  terminal_states:
    - Done
    - Closed
    - Cancelled
polling:
  interval_ms: 30000
workspace:
  root: ~/Prosel/.scorel/workspaces
hooks:
  after_create: |
    "${SCOREL_ROOT:-$HOME/Scorel}/scripts/prosel-bootstrap-workspace.sh"
  before_run: |
    "${SCOREL_ROOT:-$HOME/Scorel}/scripts/prosel-bootstrap-workspace.sh"
  timeout_ms: 60000
agent:
  max_concurrent_agents: 5
  max_turns: 20
  max_retry_backoff_ms: 300000
codex:
  command: codex app-server
  approval_policy: never
  thread_sandbox: danger-full-access
  turn_timeout_ms: 3600000
  read_timeout_ms: 30000
  stall_timeout_ms: 300000
server:
  port: 0
---
You are working on Prosel, a full-stack blog system built as a monorepo.

Issue: {{ issue.identifier }} - {{ issue.title }}
State: {{ issue.state }}
Attempt: {{ attempt }}

Requirements:
- Work only inside the assigned issue workspace.
- The canonical local source directory is `~/Prosel` unless `PROSEL_SOURCE_DIR` overrides it.
- The workspace is refreshed from the canonical source before each run, but changes are not auto-synced back.
- If the canonical source is still empty, you may bootstrap the initial monorepo structure in the current workspace.
- Keep the result practical for a Next.js + Go monorepo, not a generic demo scaffold.
- Validate the change before handing off.
- If the ticket is blocked, explain why and stop.
