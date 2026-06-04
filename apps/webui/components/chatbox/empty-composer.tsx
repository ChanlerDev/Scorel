"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState } from "react";

import {
  getConnectionPool,
  getDevicesStoreInstance,
} from "../../lib/connection/use-connection";
import {
  readLastActiveProject,
  writeLastActiveProject,
} from "../../lib/store/last-active-project";
import { requestAddProjectDialog } from "../../lib/shell/add-project-event";
import { useDevices } from "../../lib/store/use-devices";
import { createSessionForProject } from "../../lib/sync/session-create";
import { Composer } from "./composer";

export type EmptyComposerProps = {
  /** Defaults sourced from the route segment when this component is reused
   * by a device or project page. The URL `?device=` query string takes
   * precedence over both this prop and the persisted last-active map. */
  routeDeviceId?: string;
  /** Same as `routeDeviceId` but for projects. URL `?project=` wins over
   * the prop, the prop wins over the persisted-fallback. */
  routeProjectId?: string;
  /** Test seam — defaults to the production helper. Lets tests inject a
   * stub without monkey-patching the module. */
  createSession?: typeof createSessionForProject;
};

type ProjectOption = {
  projectId: string;
  displayName?: string;
};

type ProjectPickerMenuProps = {
  projects: ProjectOption[];
  activeProjectId: string | undefined;
  onProjectChange: (projectId: string) => void;
  testId: string;
  variant: "title" | "toolbar";
};

export function EmptyComposer({
  routeDeviceId,
  routeProjectId,
  createSession = createSessionForProject,
}: EmptyComposerProps): JSX.Element {
  const router = useRouter();
  const search = useSearchParams();
  const { devices } = useDevices();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Resolve effective deviceId. URL query > route segment > first device.
  const deviceId = useMemo(() => {
    const fromQuery = search?.get("device") ?? undefined;
    if (fromQuery) return fromQuery;
    if (routeDeviceId) return routeDeviceId;
    return devices[0]?.id;
  }, [search, routeDeviceId, devices]);
  const device = devices.find((d) => d.id === deviceId);
  const projects: ProjectOption[] = device?.projects ?? [];

  // Resolve effective projectId. URL query > route segment >
  // persisted last-active (per device) > first available project on this
  // device.
  const projectId = useMemo(() => {
    const fromQuery = search?.get("project") ?? undefined;
    if (fromQuery) return fromQuery;
    if (routeProjectId) return routeProjectId;
    const last = readLastActiveProject(deviceId);
    if (last && projects.find((p) => p.projectId === last)) return last;
    return projects[0]?.projectId;
  }, [search, routeProjectId, deviceId, projects]);

  // Persist the active (device, project) pair so subsequent visits
  // pre-select the same project even after the URL drops the query.
  useEffect(() => {
    if (!deviceId || !projectId) return;
    writeLastActiveProject(deviceId, projectId);
  }, [deviceId, projectId]);

  const handleProjectChange = (slug: string): void => {
    const params = new URLSearchParams(search?.toString() ?? "");
    params.set("project", slug);
    if (deviceId) params.set("device", deviceId);
    router.replace(`/?${params.toString()}`);
  };

  const handleSend = async (content: string): Promise<void> => {
    setError(null);
    if (!deviceId || !projectId) {
      setError("先选择设备和项目");
      return;
    }
    const pool = getConnectionPool();
    const client = pool.peekClient(deviceId);
    if (!client) {
      setError("设备未连接,先去 Settings 检查");
      return;
    }
    setBusy(true);
    try {
      const { sessionId } = await createSession({
        client,
        store: getDevicesStoreInstance(),
        deviceId,
        projectId,
      });
      // Stash the prompt so the session page consumes & sends it once the
      // attach controller is ready. Key includes sessionId so concurrent
      // tabs don't collide.
      if (typeof window !== "undefined") {
        window.sessionStorage.setItem(
          `scorel.pending-prompt:${sessionId}`,
          content,
        );
      }
      const target = `/devices/${encodeURIComponent(
        deviceId,
      )}/projects/${encodeURIComponent(projectId)}/sessions/${encodeURIComponent(
        sessionId,
      )}`;
      router.push(target);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  if (devices.length === 0) {
    return (
      <div
        data-testid="empty-composer-no-devices"
        className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center"
      >
        <h1 className="greeting">欢迎使用 Scorel</h1>
        <p className="text-md text-muted">先添加一个设备开始</p>
        <Link
          href="/settings"
          className="rounded-pill bg-accent px-5 py-2 text-bg hover:bg-accent-hover"
        >
          打开 Settings
        </Link>
      </div>
    );
  }

  // S0047: render the H1 with a project-aware label when one resolves.
  // Falls back to the brand-neutral question when no project is available
  // (e.g. devices exist but the picked device has no projects yet).
  const greetingProject = projects.find((p) => p.projectId === projectId);
  const greetingLabel =
    greetingProject?.displayName ?? greetingProject?.projectId;

  return (
    <div
      data-testid="empty-composer"
      className="flex h-full flex-col items-center justify-center px-4"
    >
      <div className="w-full max-w-3xl space-y-6">
        <h1
          className="greeting text-center"
          data-testid="empty-composer-greeting"
        >
          {greetingLabel ? (
            <>
              <span>我们应该在 </span>
              <ProjectPickerMenu
                projects={projects}
                activeProjectId={projectId}
                onProjectChange={handleProjectChange}
                testId="empty-composer-title-project-picker"
                variant="title"
              />
              <span> 中构建什么?</span>
            </>
          ) : (
            "我们应该构建什么?"
          )}
        </h1>
        <Composer
          onSend={handleSend}
          inFlight={false}
          placeholder="随心输入"
          disabled={busy || !deviceId || !projectId}
          errorBanner={error ?? undefined}
        />
        <PickerRow
          projects={projects}
          activeProjectId={projectId}
          onProjectChange={handleProjectChange}
        />
      </div>
    </div>
  );
}

function PickerRow({
  projects,
  activeProjectId,
  onProjectChange,
}: {
  projects: ProjectOption[];
  activeProjectId: string | undefined;
  onProjectChange: (slug: string) => void;
}): JSX.Element {
  return (
    <div
      data-testid="empty-composer-picker"
      className="mx-auto flex max-w-3xl items-center justify-center gap-3 text-sm"
    >
      <ProjectPickerMenu
        projects={projects}
        activeProjectId={activeProjectId}
        onProjectChange={onProjectChange}
        testId="empty-composer-project-picker"
        variant="toolbar"
      />
      <button
        type="button"
        disabled
        data-testid="empty-composer-mode"
        className="btn-disabled flex items-center gap-1 text-muted"
      >
        <span aria-hidden>💻</span>
        <span>本地模式</span>
        <span aria-hidden>▾</span>
      </button>
      <button
        type="button"
        disabled
        data-testid="empty-composer-branch"
        className="btn-disabled flex items-center gap-1 text-muted"
      >
        <span aria-hidden>⎇</span>
        <span>main</span>
        <span aria-hidden>▾</span>
      </button>
    </div>
  );
}

function ProjectPickerMenu({
  projects,
  activeProjectId,
  onProjectChange,
  testId,
  variant,
}: ProjectPickerMenuProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLSpanElement>(null);
  const listboxId = useId();
  const activeProject = projects.find((p) => p.projectId === activeProjectId);
  const label = activeProject?.displayName ?? activeProject?.projectId ?? "";
  const single = projects.length <= 1;
  const filteredProjects = projects.filter((project) => {
    const optionLabel = project.displayName ?? project.projectId;
    return optionLabel.toLowerCase().includes(query.trim().toLowerCase());
  });
  const triggerClass =
    variant === "title"
      ? "inline-text-control rounded-sm bg-transparent px-1 font-inherit text-inherit underline-offset-4 hover:underline"
      : "inline-flex items-center gap-1 rounded-pill bg-surface-raised px-3 py-2 text-muted outline-none transition hover:text-text focus-visible:bg-surface-raised focus-visible:text-text";
  const menuClass =
    variant === "title"
      ? "absolute left-1/2 top-full z-20 mt-2 w-72 max-w-[calc(100vw-2rem)] -translate-x-1/2 overflow-hidden rounded-md border border-subtle bg-bg text-left text-base font-normal shadow-lg"
      : "absolute left-0 top-full z-20 mt-2 w-72 max-w-[calc(100vw-2rem)] overflow-hidden rounded-md border border-subtle bg-bg text-left text-base font-normal shadow-lg";

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  useEffect(() => {
    if (open) setQuery("");
  }, [open]);

  return (
    <span
      ref={rootRef}
      data-testid={testId}
      className={
        variant === "title"
          ? "relative inline-flex align-baseline"
          : "relative inline-flex"
      }
    >
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        disabled={single}
        data-testid={`${testId}-button`}
        onClick={() => {
          if (!single) setOpen((value) => !value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") setOpen(false);
        }}
        className={triggerClass}
      >
        {variant === "toolbar" ? <span aria-hidden>📁</span> : null}
        {label}
        {variant === "toolbar" && !single ? <span aria-hidden>▾</span> : null}
      </button>
      {open ? (
        <span
          id={listboxId}
          role="listbox"
          aria-label="选择项目"
          data-testid={`${testId}-listbox`}
          className={menuClass}
        >
          <label className="mx-3 mt-3 flex items-center gap-2 border-b border-subtle pb-2 text-sm text-muted">
            <span aria-hidden>⌕</span>
            <input
              data-testid={`${testId}-search`}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索项目"
              className="min-w-0 flex-1 bg-transparent text-text outline-none placeholder:text-muted"
            />
          </label>
          <span
            data-testid={`${testId}-options`}
            className="mx-2 mt-2 flex max-h-44 flex-col overflow-y-auto pr-1"
          >
            {filteredProjects.map((project, index) => {
              const optionLabel = project.displayName ?? project.projectId;
              const selected = project.projectId === activeProjectId;
              return (
                <button
                  key={`${project.projectId}:${index}`}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  data-testid={`${testId}-option-${project.projectId}`}
                  onClick={() => {
                    setOpen(false);
                    onProjectChange(project.projectId);
                  }}
                  className="flex items-center justify-between rounded-sm px-3 py-2 text-left text-sm text-text outline-none transition hover:bg-surface-raised focus-visible:bg-surface-raised"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span aria-hidden>📁</span>
                    <span className={selected ? "font-medium" : undefined}>
                      {optionLabel}
                    </span>
                  </span>
                  {selected ? <span aria-hidden>✓</span> : null}
                </button>
              );
            })}
            {filteredProjects.length === 0 ? (
              <span className="px-3 py-2 text-sm text-muted">没有匹配项目</span>
            ) : null}
          </span>
          <span className="mt-2 block border-t border-subtle px-2 py-2">
            <button
              type="button"
              data-testid={`${testId}-add-project`}
              onClick={() => {
                setOpen(false);
                requestAddProjectDialog();
              }}
              className="flex w-full items-center justify-between rounded-sm px-3 py-2 text-left text-sm font-medium text-text outline-none transition hover:bg-surface-raised focus-visible:bg-surface-raised"
            >
              <span className="flex items-center gap-2">
                <span aria-hidden>📁+</span>
                <span>添加项目</span>
              </span>
              <span aria-hidden className="text-muted">
                ›
              </span>
            </button>
          </span>
        </span>
      ) : null}
    </span>
  );
}
