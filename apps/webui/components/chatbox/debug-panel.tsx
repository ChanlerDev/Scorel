"use client";

import { useState } from "react";

import type { ConnectionSummary } from "../../lib/diagnostics/connection-summary";

export type DebugPanelProps = {
  summary: ConnectionSummary;
};

/**
 * Floating debug card. Mounted only when `?debug=1` is set on the route. Lays
 * out a `ConnectionSummary` as a fixed-position monospaced block in the
 * bottom-right corner with a copy-to-clipboard button.
 *
 * Production behavior: this component renders nothing on its own when
 * absent — gating happens at the page level via `searchParams.debug`.
 */
export function DebugPanel({ summary }: DebugPanelProps): JSX.Element {
  const [copied, setCopied] = useState(false);
  const json = JSON.stringify(summary, null, 2);

  async function copy(): Promise<void> {
    try {
      const clipboard =
        typeof navigator !== "undefined" ? navigator.clipboard : undefined;
      if (clipboard?.writeText) {
        await clipboard.writeText(json);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }
    } catch {
      // Best-effort; clipboard API may be unavailable (insecure context, etc.)
    }
  }

  return (
    <aside
      data-testid="debug-panel"
      className="fixed bottom-4 right-4 z-50 w-80 max-w-[90vw] rounded-md border border-subtle bg-surface-raised p-3 font-mono text-[11px] leading-snug text-text shadow-md"
    >
      <header className="mb-2 flex items-center justify-between">
        <span className="text-sm font-semibold tracking-wider text-text">DEBUG</span>
        <button
          type="button"
          data-testid="debug-panel-copy"
          onClick={() => void copy()}
          className="rounded border border-subtle px-2 py-0.5 text-[10px] text-muted hover:text-accent hover:border-border-strong"
        >
          {copied ? "copied" : "copy"}
        </button>
      </header>
      <dl
        data-testid="debug-panel-body"
        className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5"
      >
        <Row label="localDevice" value={summary.localDeviceId} />
        <Row label="remoteDevice" value={summary.remoteDeviceId ?? "—"} />
        {summary.remoteDeviceDisplayName ? (
          <Row label="remoteName" value={summary.remoteDeviceDisplayName} />
        ) : null}
        <Row label="project" value={summary.projectSlug ?? "—"} />
        <Row label="session" value={summary.sessionId} />
        <Row label="conn" value={summary.connectionState} />
        <Row label="inFlight" value={String(summary.inFlight)} />
        <Row label="cancelling" value={String(summary.cancelling)} />
        <Row
          label="seq"
          value={`p=${summary.persistentLastSeq} s=${summary.streamLastSeq}`}
        />
      </dl>
    </aside>
  );
}

function Row({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <>
      <dt className="text-faint">{label}</dt>
      <dd
        data-testid={`debug-panel-${label}`}
        className="break-all text-text"
      >
        {value}
      </dd>
    </>
  );
}
