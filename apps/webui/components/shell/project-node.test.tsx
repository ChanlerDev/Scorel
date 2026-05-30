import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { ProjectNode } from "./project-node";

afterEach(() => cleanup());

describe("ProjectNode", () => {
  it("renders display name and links to the project route", () => {
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
    const link = screen.getByRole("link", { name: /Alpha/ }) as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("/devices/dev-1/projects/alpha");
    expect(screen.getByText("4")).toBeTruthy();
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
    const links = screen.getAllByRole("link");
    // First link is the project itself; sessions follow.
    const sessionLinks = links.slice(1);
    expect(sessionLinks[0]?.textContent).toBe("Newer");
    expect(sessionLinks[1]?.textContent).toBe("Older");
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
    // Only the project link is rendered.
    expect(screen.getAllByRole("link")).toHaveLength(1);
  });

  it("invokes onSelect with deviceId and projectSlug on click", () => {
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
    fireEvent.click(screen.getByText("Alpha"));
    expect(onSelect).toHaveBeenCalledWith("dev-1", "alpha");
  });

  it("does not fire onSelect when offline", () => {
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
    fireEvent.click(screen.getByText("Alpha"));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("marks the active project with aria-current", () => {
    render(
      <ul>
        <ProjectNode
          deviceId="dev-1"
          project={{ projectSlug: "alpha", displayName: "Alpha" }}
          isActive
        />
      </ul>,
    );
    const link = screen.getByRole("link", { name: /Alpha/ });
    expect(link.getAttribute("aria-current")).toBe("page");
  });
});
