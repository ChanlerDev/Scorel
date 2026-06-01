import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const _push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: _push, replace: vi.fn(), back: vi.fn() }),
}));

import { NewChatButton } from "./new-chat-button";

beforeEach(() => {
  _push.mockReset();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("NewChatButton", () => {
  it("navigates to `/` when no device or project is in context", () => {
    render(
      <NewChatButton
        deviceId={undefined}
        projectId={undefined}
        variant="sidebar"
      />,
    );
    const btn = screen.getByRole("button", { name: /New Chat/ });
    fireEvent.click(btn);
    expect(_push).toHaveBeenCalledTimes(1);
    expect(_push).toHaveBeenCalledWith("/");
  });

  it("forwards device and project as query params when both are present", () => {
    render(
      <NewChatButton
        deviceId="dev_abc"
        projectId="alpha"
        variant="sidebar"
      />,
    );
    const btn = screen.getByRole("button", { name: /New Chat/ });
    fireEvent.click(btn);
    expect(_push).toHaveBeenCalledTimes(1);
    const target = _push.mock.calls[0]?.[0] as string;
    expect(target.startsWith("/?")).toBe(true);
    expect(target).toContain("device=dev_abc");
    expect(target).toContain("project=alpha");
  });

  it("forwards only device when project is missing", () => {
    render(
      <NewChatButton
        deviceId="dev_abc"
        projectId={undefined}
        variant="page"
      />,
    );
    const btn = screen.getByRole("button", { name: /New Chat/ });
    fireEvent.click(btn);
    expect(_push).toHaveBeenCalledWith("/?device=dev_abc");
  });

  it("encodes special characters in device and project", () => {
    render(
      <NewChatButton
        deviceId="dev with space"
        projectId="proj/slash"
        variant="sidebar"
      />,
    );
    const btn = screen.getByRole("button", { name: /New Chat/ });
    fireEvent.click(btn);
    const target = _push.mock.calls[0]?.[0] as string;
    expect(target).toContain("device=dev+with+space");
    expect(target).toContain("project=proj%2Fslash");
  });

  it("renders without `disabled` and never shows an error banner", () => {
    render(
      <NewChatButton
        deviceId={undefined}
        projectId={undefined}
        variant="sidebar"
      />,
    );
    const btn = screen.getByRole("button", { name: /New Chat/ });
    expect(btn.hasAttribute("disabled")).toBe(false);
    // No `role=alert` exists in the new lazy-create design.
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("uses sidebar styling for variant=sidebar (full-width)", () => {
    render(
      <NewChatButton
        deviceId="dev_abc"
        projectId="alpha"
        variant="sidebar"
      />,
    );
    const btn = screen.getByRole("button", { name: /New Chat/ });
    expect(btn.className).toContain("w-full");
  });

  it("uses inline styling for variant=page (inline-flex)", () => {
    render(
      <NewChatButton
        deviceId="dev_abc"
        projectId="alpha"
        variant="page"
      />,
    );
    const btn = screen.getByRole("button", { name: /New Chat/ });
    expect(btn.className).toContain("inline-flex");
  });
});
