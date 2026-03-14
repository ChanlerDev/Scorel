---
tracker:
  kind: linear
  api_key: $LINEAR_API_KEY
  project_slug: your-project-slug
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
  root: ./workspaces
hooks:
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
  read_timeout_ms: 5000
  stall_timeout_ms: 300000
server:
  port: 0
---
You are working on a Linear issue.

Issue: {{ issue.identifier }} - {{ issue.title }}
State: {{ issue.state }}
Attempt: {{ attempt }}

Requirements:
- Work only inside the assigned workspace.
- Validate the change before handing off.
- If the ticket is blocked, explain why and stop.
