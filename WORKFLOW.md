---
tracker:
  kind: linear
  api_key: $LINEAR_API_KEY
  project_slug: prosel-the-prose-system-5d795b228b00
  active_states:
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
  max_concurrent_agents: 1
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
- Workspace bootstrap is git-based and should sync from `origin/main` by default.
- The default git remote is `git@github.com:ChanlerDev/Prosel.git` unless `PROSEL_GIT_REMOTE` overrides it.
- If the workspace contains uncommitted or ahead-of-origin local work, bootstrap must preserve it instead of resetting it.
- Keep the result practical for a Next.js + Go monorepo, not a generic demo scaffold.
- Validate the change before handing off.
- If the ticket is blocked, explain why and stop.
