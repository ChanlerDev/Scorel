import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

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
    expect(link.textContent).toBe("Hello");
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
  });
});
