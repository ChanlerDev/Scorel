"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import {
  getConnectionPool,
  getDevicesStoreInstance,
} from "../../lib/connection/use-connection";
import {
  readLastActiveProject,
  writeLastActiveProject,
} from "../../lib/store/last-active-project";
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
  const greetingText = greetingLabel
    ? `我们应该在 ${greetingLabel} 中构建什么?`
    : "我们应该构建什么?";

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
          {greetingText}
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
          activeSlug={projectId}
          onProjectChange={handleProjectChange}
        />
      </div>
    </div>
  );
}

function PickerRow({
  projects,
  activeSlug,
  onProjectChange,
}: {
  projects: ProjectOption[];
  activeSlug: string | undefined;
  onProjectChange: (slug: string) => void;
}): JSX.Element {
  const single = projects.length <= 1;
  return (
    <div
      data-testid="empty-composer-picker"
      className="mx-auto flex max-w-3xl items-center justify-center gap-3 text-sm"
    >
      <label className="flex items-center gap-1 text-muted">
        <span aria-hidden>📁</span>
        <select
          data-testid="empty-composer-project-select"
          value={activeSlug ?? ""}
          onChange={(e) => onProjectChange(e.target.value)}
          disabled={single}
          aria-label="选择项目"
          className="rounded-sm bg-transparent text-text outline-none focus-visible:outline-2 focus-visible:outline-text disabled:cursor-default"
        >
          {projects.length === 0 ? (
            <option value="" disabled>
              (no projects)
            </option>
          ) : (
            projects.map((p) => (
              <option key={p.projectId} value={p.projectId}>
                {p.displayName ?? p.projectId}
              </option>
            ))
          )}
        </select>
      </label>
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
