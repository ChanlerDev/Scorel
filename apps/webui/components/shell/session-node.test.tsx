import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";

import { SessionNode } from "./session-node";

afterEach(() => cleanup());

describe("SessionNode", () => {
  it("renders a link with the session title and URL-encodes the slug + sessionId", () => {
    render(
      <ul>
        <SessionNode
          deviceId="dev-1"
          projectSlug="my project"
          session={{
            sessionId: "session/abc",
            title: "Hello",
            updatedAt: 1,
          }}
        />
      </ul>,
    );
    const link = screen.getByRole("link") as HTMLAnchorElement;
    expect(link.textContent).toContain("Hello");
    expect(link.getAttribute("href")).toBe(
      "/devices/dev-1/projects/my%20project/sessions/session%2Fabc",
    );
  });

  it("falls back to sessionId when title is missing", () => {
    render(
      <ul>
        <SessionNode
          deviceId="dev-1"
          projectSlug="alpha"
          session={{ sessionId: "session_xyz", updatedAt: 1 }}
        />
      </ul>,
    );
    expect(screen.getByText("session_xyz")).toBeTruthy();
  });

  it("highlights the active session", () => {
    render(
      <ul>
        <SessionNode
          deviceId="dev-1"
          projectSlug="alpha"
          session={{ sessionId: "s", title: "Active", updatedAt: 1 }}
          isActive
        />
      </ul>,
    );
    const link = screen.getByRole("link");
    expect(link.getAttribute("aria-current")).toBe("page");
    expect(link.className).toContain("font-medium");
  });

  it("renders the relative-time hint after mount", () => {
    // jsdom + RTL run effects synchronously inside `render` for client
    // components, so the `useEffect` setNow has fired before our assertion.
    const now = Date.now();
    render(
      <ul>
        <SessionNode
          deviceId="dev-1"
          projectSlug="alpha"
          session={{
            sessionId: "s",
            title: "Active",
            updatedAt: now - 30 * 60_000,
          }}
        />
      </ul>,
    );
    expect(screen.getByText(/分钟/)).toBeTruthy();
  });

  it("emits empty hint when updatedAt is missing", () => {
    render(
      <ul>
        <SessionNode
          deviceId="dev-1"
          projectSlug="alpha"
          session={{ sessionId: "s", title: "Active" }}
        />
      </ul>,
    );
    // No 分钟/小时/天/周/个月/年/刚刚 marker means no hint rendered.
    expect(screen.queryByText(/(刚刚|分钟|小时|天|周|个月|年)/)).toBeNull();
  });
});

describe("SessionNode 1-minute interval", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("recomputes the hint after 60 seconds and clears the interval on unmount", () => {
    const updatedAt = Date.parse("2025-12-31T23:59:30Z"); // 30s ago
    const { unmount } = render(
      <ul>
        <SessionNode
          deviceId="dev-1"
          projectSlug="alpha"
          session={{ sessionId: "s", title: "Active", updatedAt }}
        />
      </ul>,
    );

    // First paint: 30s ago -> 刚刚
    expect(screen.getByText("刚刚")).toBeTruthy();

    // Advance 1 minute. Now 1m 30s ago -> "1 分钟".
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.getByText("1 分钟")).toBeTruthy();

    // Unmount and ensure the interval is cleared (no leak; vitest tracks
    // pending timers).
    unmount();
    // No more SessionNode in the DOM after unmount.
    expect(screen.queryByText(/分钟|刚刚/)).toBeNull();
  });
});
