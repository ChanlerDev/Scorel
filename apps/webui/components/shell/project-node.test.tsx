import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const _push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: _push, replace: vi.fn(), back: vi.fn() }),
}));

import { ProjectNode } from "./project-node";
import { __resetCollapsedForTests } from "../../lib/store/use-collapsed";

beforeEach(() => {
  _push.mockReset();
});

afterEach(() => {
  cleanup();
  if (typeof window !== "undefined") window.localStorage.clear();
  __resetCollapsedForTests();
});

describe("ProjectNode", () => {
  it("renders display name on a button (no <a href> route navigation)", () => {
    render(
      <ul>
        <ProjectNode
          deviceId="dev-1"
          project={{
            projectSlug: "alpha",
            displayName: "Alpha",
            sessionCount: 4,
          }}
        />
      </ul>,
    );
    const button = screen.getByRole("button", { name: /^Alpha/ });
    expect(button.tagName).toBe("BUTTON");
    expect(screen.getByText("4")).toBeTruthy();
    // Project rows MUST NOT be links (S0045 §1).
    expect(screen.queryByRole("link", { name: /Alpha/ })).toBeNull();
  });

  it("falls back to the projectSlug when displayName is missing", () => {
    render(
      <ul>
        <ProjectNode
          deviceId="dev-1"
          project={{ projectSlug: "raw-slug" }}
        />
      </ul>,
    );
    expect(screen.getByText("raw-slug")).toBeTruthy();
  });

  it("renders cached sessions newest-first", () => {
    render(
      <ul>
        <ProjectNode
          deviceId="dev-1"
          project={{
            projectSlug: "alpha",
            sessions: {
              older: { sessionId: "older", title: "Older", updatedAt: 100 },
              newer: { sessionId: "newer", title: "Newer", updatedAt: 500 },
            },
          }}
        />
      </ul>,
    );
    const sessionLinks = screen.getAllByRole("link");
    expect(sessionLinks[0]?.textContent).toContain("Newer");
    expect(sessionLinks[1]?.textContent).toContain("Older");
  });

  it("falls back to derived sessionCount from sessions when sessionCount is undefined", () => {
    render(
      <ul>
        <ProjectNode
          deviceId="dev-1"
          project={{
            projectSlug: "alpha",
            displayName: "Alpha",
            sessions: {
              s1: { sessionId: "s1", title: "S1", updatedAt: 1 },
              s2: { sessionId: "s2", title: "S2", updatedAt: 2 },
            },
          }}
        />
      </ul>,
    );
    expect(screen.getByText("2")).toBeTruthy();
  });

  it("hides session list when there are no cached sessions", () => {
    render(
      <ul>
        <ProjectNode
          deviceId="dev-1"
          project={{ projectSlug: "alpha", displayName: "Alpha" }}
        />
      </ul>,
    );
    // Only the project button is rendered; no session links.
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });

  it("toggles collapse state on click and fires onSelect on expand only", () => {
    const onSelect = vi.fn();
    // Default state is expanded (false), and project has cached sessions so
    // onSelect should NOT fire on the initial mount-fire branch.
    render(
      <ul>
        <ProjectNode
          deviceId="dev-1"
          project={{
            projectSlug: "alpha",
            displayName: "Alpha",
            sessions: { s1: { sessionId: "s1", title: "S1", updatedAt: 1 } },
          }}
          onSelect={onSelect}
        />
      </ul>,
    );
    expect(onSelect).not.toHaveBeenCalled();
    const button = screen.getByRole("button", { name: /^Alpha/ });

    // First click: collapse — should NOT fire onSelect.
    fireEvent.click(button);
    expect(onSelect).not.toHaveBeenCalled();

    // Second click: expand — fires onSelect.
    fireEvent.click(button);
    expect(onSelect).toHaveBeenCalledWith("dev-1", "alpha");
  });

  it("does not fire onSelect when offline even on expand", () => {
    const onSelect = vi.fn();
    render(
      <ul>
        <ProjectNode
          deviceId="dev-1"
          project={{
            projectSlug: "alpha",
            displayName: "Alpha",
            sessions: { s1: { sessionId: "s1", title: "S1", updatedAt: 1 } },
          }}
          onSelect={onSelect}
          offline
        />
      </ul>,
    );
    const button = screen.getByRole("button", { name: /^Alpha/ });
    fireEvent.click(button); // collapse
    fireEvent.click(button); // expand
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("fires onSelect once on mount when expanded but sessions are missing", () => {
    const onSelect = vi.fn();
    render(
      <ul>
        <ProjectNode
          deviceId="dev-1"
          project={{ projectSlug: "alpha", displayName: "Alpha" }}
          onSelect={onSelect}
        />
      </ul>,
    );
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith("dev-1", "alpha");
  });

  it("does NOT fire mount-fire when offline", () => {
    const onSelect = vi.fn();
    render(
      <ul>
        <ProjectNode
          deviceId="dev-1"
          project={{ projectSlug: "alpha", displayName: "Alpha" }}
          onSelect={onSelect}
          offline
        />
      </ul>,
    );
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("aria-expanded reflects collapse state", () => {
    render(
      <ul>
        <ProjectNode
          deviceId="dev-1"
          project={{ projectSlug: "alpha", displayName: "Alpha" }}
        />
      </ul>,
    );
    const button = screen.getByRole("button", { name: /^Alpha/ });
    expect(button.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("false");
  });

  it("renders a hidden ✏ new-chat button per row (S0047)", () => {
    render(
      <ul>
        <ProjectNode
          deviceId="dev-1"
          project={{ projectSlug: "alpha", displayName: "Alpha" }}
        />
      </ul>,
    );
    const editBtn = screen.getByTestId("project-new-chat-alpha");
    // Hidden by default; only visible on group-hover or focus-visible.
    expect(editBtn.className).toContain("hidden");
    expect(editBtn.className).toContain("group-hover:flex");
    expect(editBtn.className).toContain("focus-visible:flex");
    // aria-label / title use displayName (no hardcoded brand).
    expect(editBtn.getAttribute("aria-label")).toBe(
      "在 Alpha 中开始新对话",
    );
    expect(editBtn.getAttribute("title")).toBe("在 Alpha 中开始新对话");
  });

  it("✏ button labels fall back to projectSlug when displayName is missing", () => {
    render(
      <ul>
        <ProjectNode deviceId="dev-1" project={{ projectSlug: "raw-slug" }} />
      </ul>,
    );
    const editBtn = screen.getByTestId("project-new-chat-raw-slug");
    expect(editBtn.getAttribute("aria-label")).toBe(
      "在 raw-slug 中开始新对话",
    );
  });

  it("clicking ✏ routes to /?device=&project= and does NOT toggle collapse", () => {
    render(
      <ul>
        <ProjectNode
          deviceId="dev-1"
          project={{
            projectSlug: "alpha",
            displayName: "Alpha",
            sessions: { s1: { sessionId: "s1", title: "S1", updatedAt: 1 } },
          }}
        />
      </ul>,
    );
    const projectBtn = screen.getByRole("button", { name: /^Alpha/ });
    // Sanity: starts expanded.
    expect(projectBtn.getAttribute("aria-expanded")).toBe("true");
    const editBtn = screen.getByTestId("project-new-chat-alpha");
    fireEvent.click(editBtn);
    expect(_push).toHaveBeenCalledTimes(1);
    const target = _push.mock.calls[0]?.[0] as string;
    expect(target.startsWith("/?")).toBe(true);
    expect(target).toContain("device=dev-1");
    expect(target).toContain("project=alpha");
    // Toggle did not fire — aria-expanded unchanged.
    expect(projectBtn.getAttribute("aria-expanded")).toBe("true");
  });
});
