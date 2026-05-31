"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  getConnectionPool,
  getDevicesStoreInstance,
} from "../../lib/connection/use-connection";
import { createSessionForProject } from "../../lib/sync/session-create";

export type NewChatButtonProps = {
  /** Active route's deviceId. When undefined the button is disabled. */
  deviceId: string | undefined;
  /** Active route's projectSlug. When undefined the button is disabled with
   * an explanatory tooltip. */
  projectSlug: string | undefined;
  /** Visual variant: `sidebar` is the compact full-width pill; `page`
   * is a primary action button rendered above the project's session list. */
  variant: "sidebar" | "page";
  /** Test seam — defaults to the production helper. Lets the project-page
   * and sidebar tests inject a stub. */
  createSession?: typeof createSessionForProject;
};

const SIDEBAR_BASE =
  "w-full rounded-md border px-3 py-1.5 text-left text-sm transition-colors";
const PAGE_BASE =
  "inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors";

const ENABLED_THEME =
  "border-accent bg-accent text-bg hover:bg-accent-hover";
const DISABLED_THEME =
  "border-subtle bg-surface text-faint cursor-not-allowed";

export function NewChatButton({
  deviceId,
  projectSlug,
  variant,
  createSession = createSessionForProject,
}: NewChatButtonProps): JSX.Element {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ready = Boolean(deviceId && projectSlug);
  const tooltip = ready
    ? undefined
    : "Select a project first";

  const handleClick = async (): Promise<void> => {
    if (!ready || !deviceId || !projectSlug) return;
    setError(null);
    const pool = getConnectionPool();
    const client = pool.peekClient(deviceId);
    if (!client) {
      setError("Connect to the device first");
      return;
    }
    const store = getDevicesStoreInstance();
    setCreating(true);
    try {
      const { sessionId } = await createSession({
        client,
        store,
        deviceId,
        projectSlug,
      });
      const target = `/devices/${encodeURIComponent(
        deviceId,
      )}/projects/${encodeURIComponent(projectSlug)}/sessions/${encodeURIComponent(
        sessionId,
      )}`;
      router.push(target);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
    } finally {
      setCreating(false);
    }
  };

  const base = variant === "sidebar" ? SIDEBAR_BASE : PAGE_BASE;
  const theme = ready ? ENABLED_THEME : DISABLED_THEME;

  return (
    <div className={variant === "sidebar" ? "space-y-1" : "space-y-2"}>
      <button
        type="button"
        disabled={!ready || creating}
        title={tooltip}
        aria-disabled={!ready || creating}
        onClick={() => {
          void handleClick();
        }}
        className={`${base} ${theme} ${creating ? "opacity-70" : ""}`}
      >
        {creating ? "Creating session…" : "+ New Chat"}
      </button>
      {error ? (
        <p
          role="alert"
          className="rounded-md border border-status-err bg-surface-raised px-3 py-2 text-xs text-status-err"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
