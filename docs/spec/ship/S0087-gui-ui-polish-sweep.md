# S0087: Codex-Inspired GUI Visual Pass

## Goal

Move the Scorel desktop GUI closer to a mature Codex-style workbench without copying Codex screen-for-screen.

The business value is product trust. Scorel should stop feeling like an engineering demo and start feeling like a quiet, high-density desktop tool for project-scoped agent work.

This spec is a visual-system pass over existing GUI surfaces. It does not introduce new product capabilities.

## Design Direction

Learn from Codex at the level of visual principles:

- restrained source-list sidebar;
- white main workspace with low visual noise;
- natural heading text instead of badge-heavy emphasis;
- composer as a command surface with a clear input/control row;
- metadata controls visually attached to the composer;
- quiet active states, subtle borders, and shallow elevation;
- compact but readable typography.

Do not copy Codex literally. Scorel remains Project-first and should only show real controls backed by existing product paths.

## Scope

### Visual Pass Targets

- Sidebar source list:
  - reduce heavy active row treatment;
  - tighten project/session row rhythm;
  - make empty session rows quieter;
  - load session lists for the selected Project and expanded Projects so startup stays responsive without stale empty states;
  - keep Add Project as the real project-management entry.

- Empty workspace:
  - hide the empty topbar when it has no useful content;
  - render the project name as natural heading text, not a large grey badge;
  - keep the hero centered but calmer and less heavy.

- Composer:
  - reduce shadow and heavy pill feel;
  - add whole-surface focus feedback;
  - make model selection and send action read as a compact control row;
  - keep fake controls such as attachment, voice, and permission mode hidden.

- Project metadata:
  - keep project picker as a real control;
  - visually attach the project picker to the composer area;
  - keep the popover anchored and searchable.

- Active session:
  - keep a stable topbar title fallback (`未命名对话`) until auxiliary title generation updates it.
  - keep expanded thinking content within the message column, with long prose wrapping and code blocks scrolling internally.
  - render code-block language and copy controls inside the code-block header.
  - render tool calls as compact execution evidence rows: clear tool name, target object, status, counters, and expandable details.
  - keep successful tool output collapsed by default, while making errors, diffs, and pending/running state visible.

### Tool Display Contract

- `Read`: collapsed header shows file basename and line range; expanded details show the returned read text and full path/range evidence.
- `Glob` / `Grep`: collapsed header shows pattern/result count; expanded details show the returned file or match list plus pagination/mode metadata when present.
- `Bash`: collapsed header shows command and exit status when known; expanded details show stdout/stderr/cwd evidence returned by the tool.
- `Edit` / `Write`: collapsed header shows operation, file basename, and `+/-` counters; diff details are visible by default and remain collapsible.
- `TodoWrite`: collapsed header shows active progress; expanded details show the current todo list and item states.
- Fallback tools: collapsed header shows tool name; expanded details show args/result JSON.

## Not In Scope

- New GUI product capability such as SSH remote device, HTTP API, account/auth, review banner, or changed-files diff surface.
- Runtime, provider/model, memory, channel, extension, or daemon contract changes.
- Reintroducing disabled placeholder commands.
- Empty-state plugin recommendation cards.
- Global conversation history grouping.
- Voice, attachment, permission-mode, or null-project mode.
- WebUI component reuse or shared UI package extraction.
- Streaming thinking/runtime protocol changes. Thinking currently arrives with final persistent assistant messages; streaming thinking requires a follow-up protocol/runtime spec.

## Acceptance Criteria

- Empty workspace has no blank topbar.
- Empty heading uses natural text, with no badge-like project-name background.
- Composer has low-shadow elevation, stable focus feedback, and no unimplemented controls.
- Project picker remains visible and attached to the composer cluster.
- Sidebar active and empty states are quiet and source-list-like.
- Startup loads session summaries for the selected Project and expanded Projects, not every Project.
- Expanded thinking content cannot horizontally stretch the workspace.
- Long prose wraps inside thinking/markdown content, while code blocks keep formatting and scroll internally.
- Code blocks show the fenced language as non-interactive metadata on the top-left and a copy control on the top-right.
- GUI tool blocks read as a low-noise execution trace, not generic JSON dumps.
- Bash, Read, Glob/Grep, Edit/Write, TodoWrite, and fallback JSON tools share consistent header/body/error/pending styling.
- File edits surface filename and diff counters in the header; expanded details keep diff/output internally scrollable.
- Clicking a tool header reveals the right evidence for that tool type, not just raw arguments.
- Active sessions show `未命名对话` when no generated title exists.
- Existing GUI behavior remains Project-first.
- Text remains readable and non-overlapping across narrow and normal desktop widths.
- Sidebar collapse/resize behavior still works.
- GUI shell render tests cover the changed contracts.
- Full `pnpm typecheck && pnpm test` passes.

## Testing Requirements

- Focused GUI tests:

```bash
pnpm --filter @scorel/app-gui test
```

- GUI build:

```bash
pnpm --filter @scorel/app-gui build
```

- Full check:

```bash
pnpm typecheck && pnpm test
```

- Whitespace check:

```bash
git diff --check
```

- Run Electron GUI and visually inspect the empty workspace.

## Impacted Files

- `apps/gui/src/renderer/workspace/Workspace.tsx`
- `apps/gui/src/renderer/App.tsx`
- `apps/gui/src/renderer/shell/Sidebar.tsx`
- `apps/gui/src/renderer/shell/ProjectTree.tsx`
- `apps/gui/src/renderer/workspace/EmptyState.tsx`
- `apps/gui/src/renderer/composer/Composer.tsx`
- `apps/gui/src/renderer/chatbox/ShikiCodeBlock.tsx`
- `apps/gui/src/renderer/chatbox/ShikiCodeBlock.test.tsx`
- `apps/gui/src/renderer/chatbox/tool-blocks/*`
- `apps/gui/src/renderer/styles.css`
- `apps/gui/src/renderer/gui-shell.test.tsx`
- `apps/gui/src/renderer/app-session-preload.test.tsx`
- `apps/gui/src/sidebar-layout.test.ts`
- `docs/ROADMAP.md`
- `docs/spec/ship/S0087-gui-ui-polish-sweep.md`

## Risks And Boundaries

- Visual polish can sprawl. Keep this pass focused on existing workbench surfaces.
- A better-looking fake feature is still bad product design. Hide unimplemented controls instead of styling them.
- Render tests prove structure but not taste. Use manual GUI inspection before handoff.
