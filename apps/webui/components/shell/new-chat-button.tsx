"use client";

import { useRouter } from "next/navigation";

export type NewChatButtonProps = {
  /** Active route's deviceId (forwarded as `?device=` so the empty composer
   * lands on the same device). When undefined, the button still navigates to
   * `/` so the user can land on the empty composer and pick a device. */
  deviceId: string | undefined;
  /** Active route's projectId (forwarded as `?project=`). When undefined,
   * the empty composer falls back to its persisted last-active project /
   * first available. */
  projectId: string | undefined;
  /** Visual variant: `sidebar` is the compact full-width pill; `page`
   * is a primary action button rendered above the project's session list. */
  variant: "sidebar" | "page";
};

const SIDEBAR_BASE =
  "w-full rounded-md border px-3 py-1.5 text-left text-sm transition-colors";
const PAGE_BASE =
  "inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors";

const ENABLED_THEME =
  "border-accent bg-accent text-bg hover:bg-accent-hover";

/**
 * S0046: New Chat is no longer a session-creation button — it navigates to
 * the empty-state composer at `/`, optionally carrying the active route's
 * `device` / `project` as query parameters so the composer pre-selects them.
 * Session creation is deferred to the user's first send inside
 * `EmptyComposer.handleSend`. The boundary test enforces that this file no
 * longer imports `lib/sync/session-create`.
 */
export function NewChatButton({
  deviceId,
  projectId,
  variant,
}: NewChatButtonProps): JSX.Element {
  const router = useRouter();

  const handleClick = (): void => {
    const params = new URLSearchParams();
    if (deviceId) params.set("device", deviceId);
    if (projectId) params.set("project", projectId);
    const target = params.toString() ? `/?${params.toString()}` : "/";
    router.push(target);
  };

  const base = variant === "sidebar" ? SIDEBAR_BASE : PAGE_BASE;

  return (
    <button
      type="button"
      onClick={handleClick}
      className={`${base} ${ENABLED_THEME}`}
    >
      + New Chat
    </button>
  );
}
