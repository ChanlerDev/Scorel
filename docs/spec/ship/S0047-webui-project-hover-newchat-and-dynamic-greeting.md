# S0047: WebUI Project Hover New-Chat Button + Dynamic Empty H1

## Goal

Two small fixes after S0046 ship:

1. **Project hover new-chat button**: each Sidebar Project row exposes a hover-only `✏` button on the right; click navigates to `/?device=&project=` (the empty composer pre-populated with that project). Same shape as Chatbox app's "在 X 中开始新对话" entry.
2. **Dynamic H1**: `EmptyComposer` H1 must not hardcode "Scorel". Render `我们应该在 {projectDisplayName} 中构建什么?` using the resolved project's `displayName ?? projectSlug`. Fall back to `我们应该构建什么?`(no project name) when no project resolves.

Locked by user feedback after `97b338b`. No brainstorm — both fixes are tiny + visually obvious from the screenshot.

---

## Scope

### 1. ProjectNode hover button

`apps/webui/components/shell/project-node.tsx`:

Wrap the existing `<button type="button" onClick={handleClick}>` in a flex container that exposes a sibling `<button>` rendered only on hover/focus. The whole row stays click-toggle; the `✏` button is a separate hit area.

Keyboard accessibility: the new button is focusable; tabbing through the sidebar reveals it. Hover behavior uses the parent `group` Tailwind class so the button only paints on row hover.

```tsx
"use client";

import { useRouter } from "next/navigation";
// ... existing imports ...

export function ProjectNode({
  deviceId,
  project,
  activeSessionId,
  offline,
  onSelect,
}: ProjectNodeProps): JSX.Element {
  const router = useRouter();
  // ... existing logic unchanged through `handleClick` ...

  function handleNewChat(event: React.MouseEvent | React.KeyboardEvent): void {
    event.stopPropagation();
    const params = new URLSearchParams();
    params.set("device", deviceId);
    params.set("project", project.projectSlug);
    router.push(`/?${params.toString()}`);
  }

  return (
    <li>
      <div className="group relative flex w-full items-center">
        <button
          type="button"
          onClick={handleClick}
          aria-expanded={!collapsed}
          className="flex flex-1 items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-sm text-text hover:bg-surface-hover"
        >
          <span className="truncate">
            {project.displayName ?? project.projectSlug}
          </span>
          {sessionCount !== undefined ? (
            <span className="shrink-0 text-xs text-faint">{sessionCount}</span>
          ) : null}
        </button>
        <button
          type="button"
          onClick={handleNewChat}
          data-testid={`project-new-chat-${project.projectSlug}`}
          aria-label={`在 ${project.displayName ?? project.projectSlug} 中开始新对话`}
          title={`在 ${project.displayName ?? project.projectSlug} 中开始新对话`}
          className="ml-1 hidden h-6 w-6 shrink-0 items-center justify-center rounded-sm text-muted hover:bg-surface-hover hover:text-text group-hover:flex focus-visible:flex"
        >
          <span aria-hidden>✏</span>
        </button>
      </div>
      {/* ... existing collapse/sessions list unchanged ... */}
    </li>
  );
}
```

Notes:

- `group-hover:flex` toggles visibility on parent hover; `focus-visible:flex` on the button itself ensures keyboard navigation reveals it.
- `event.stopPropagation()` prevents the row's `handleClick` from firing the toggle when the user clicks the `✏` button.
- Native `disabled` not used — this button always works as long as the device is configured. (Offline state could disable it later; out of scope.)

### 2. EmptyComposer dynamic H1

`apps/webui/components/chatbox/empty-composer.tsx`:

Compute `projectLabel`:

```tsx
const project = projects.find((p) => p.projectSlug === projectSlug);
const projectLabel = project?.displayName ?? project?.projectSlug;

const greetingText = projectLabel
  ? `我们应该在 ${projectLabel} 中构建什么?`
  : `我们应该构建什么?`;
```

Render:

```tsx
<h1 className="greeting text-center" data-testid="empty-composer-greeting">
  {greetingText}
</h1>
```

Zero-devices branch keeps "欢迎使用 Scorel" since that's a brand greeting (not a project name) — acceptable hardcode.

### 3. Tests

**Modified — `project-node.test.tsx`**:

- New case: render with hovered row → `✏` button appears (Tailwind hover state hard to assert in jsdom; assert it's in the DOM with the `hidden` class and that click triggers `router.push`). Use `data-testid="project-new-chat-<slug>"` for selection.
- Click `✏` button → `router.push("/?device=…&project=…")` called once. Use `vi.mock` for `useRouter` like other sidebar tests.
- Click `✏` does NOT fire toggle: existing `handleClick` not invoked. Verify by checking `useCollapsed` state unchanged after click.

**Modified — `empty-composer.test.tsx`**:

- When projects array contains a project with `displayName: "Scorel"`, H1 reads "我们应该在 Scorel 中构建什么?".
- When projects exist but no `displayName`, H1 uses `projectSlug`.
- When projects array empty (but devices exist), H1 reads "我们应该构建什么?".
- Zero-devices branch unchanged ("欢迎使用 Scorel").

### 4. Boundary

No new dependencies. No daemon changes. Files touched: 2 source + 2 test.

---

## Not In Scope

- Project row `...` overflow menu (rename / delete / settings).
- Disabling `✏` when device offline.
- Editable session title in chatbox.
- ROADMAP milestone update — append S0047 spec row only.

---

## Acceptance Criteria

1. ProjectNode renders a hidden `✏` button per row; CSS class set so it only appears on `group-hover` or `focus-visible`.
2. Click `✏` calls `router.push("/?device=<deviceId>&project=<slug>")`.
3. Click `✏` does NOT toggle the project's collapsed state. Existing row-click toggle behavior preserved.
4. `aria-label` and `title` use `project.displayName ?? project.projectSlug` (no hardcoded brand).
5. EmptyComposer H1 reads `我们应该在 {displayName ?? slug} 中构建什么?` when a project resolves.
6. EmptyComposer H1 falls back to `我们应该构建什么?` when no project resolves (devices exist but projects empty).
7. Zero-devices branch unchanged.
8. `pnpm --filter @scorel/app-webui typecheck && test && build` green.
9. Repo `pnpm typecheck && pnpm test` green.
10. Manual e2e:
    - Hover any project row → `✏` appears on right.
    - Click `✏` → routes to `/?device=&project=` with that row's context; H1 shows that project's name.
    - Sidebar `+ 新对话` from a session route still works (S0046 path).
    - On `/?project=Scorel` H1 reads "我们应该在 Scorel 中构建什么?".

---

## Affected Paths

- `apps/webui/components/shell/project-node.tsx`
- `apps/webui/components/shell/project-node.test.tsx`
- `apps/webui/components/chatbox/empty-composer.tsx`
- `apps/webui/components/chatbox/empty-composer.test.tsx`
- `docs/ROADMAP.md` — append S0047 spec row only

---

## Risks And Boundaries

- **`group-hover` reliability in jsdom**: jsdom doesn't apply real CSS hover, so the test asserts the button exists in the DOM with `data-testid` + that click fires the right router call. Visual hover behavior is verified manually.
- **Stop-propagation correctness**: missing `event.stopPropagation()` would toggle collapse on `✏` click. The test asserts the toggle didn't fire.
- **Project label fallback chain**: `displayName ?? projectSlug` — both could be empty strings (rare, defensive). If both empty, H1 reads "我们应该在 中构建什么?" — accept; daemon-side validation should keep slug non-empty.
- **Single commit**: `S0047: feat: project hover new-chat + dynamic empty greeting`.
