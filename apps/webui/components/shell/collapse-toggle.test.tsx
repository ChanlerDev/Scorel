import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { CollapseToggle } from "./collapse-toggle";
import { __resetCollapsedForTests } from "../../lib/store/use-collapsed";

beforeEach(() => {
  if (typeof window !== "undefined") window.localStorage.clear();
  __resetCollapsedForTests();
});

afterEach(() => {
  cleanup();
  if (typeof window !== "undefined") window.localStorage.clear();
  __resetCollapsedForTests();
});

describe("CollapseToggle", () => {
  it("renders ▾ when not collapsed and ▸ when collapsed", () => {
    render(<CollapseToggle id="x" />);
    const button = screen.getByTestId("collapse-toggle");
    expect(button.dataset.collapsed).toBe("false");
    expect(button.textContent).toBe("▾");
    expect(button.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(button);
    expect(button.dataset.collapsed).toBe("true");
    expect(button.textContent).toBe("▸");
    expect(button.getAttribute("aria-expanded")).toBe("false");
  });

  it("persists collapse state to localStorage under the canonical key", () => {
    render(<CollapseToggle id="device:abc" />);
    const button = screen.getByTestId("collapse-toggle");
    fireEvent.click(button);
    const raw = window.localStorage.getItem("scorel.ui.collapsed");
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw as string)).toEqual({ "device:abc": true });
    fireEvent.click(button);
    const raw2 = window.localStorage.getItem("scorel.ui.collapsed");
    expect(JSON.parse(raw2 as string)).toEqual({ "device:abc": false });
  });

  it("rehydrates persisted state on a fresh mount", () => {
    window.localStorage.setItem(
      "scorel.ui.collapsed",
      JSON.stringify({ "project:dev/alpha": true }),
    );
    __resetCollapsedForTests();
    render(<CollapseToggle id="project:dev/alpha" />);
    const button = screen.getByTestId("collapse-toggle");
    expect(button.dataset.collapsed).toBe("true");
    expect(button.textContent).toBe("▸");
  });

  it("toggle on one row broadcasts to a sibling with the same id", () => {
    render(
      <div>
        <CollapseToggle id="shared" />
        <CollapseToggle id="shared" />
      </div>,
    );
    const buttons = screen.getAllByTestId("collapse-toggle");
    expect(buttons).toHaveLength(2);
    expect(buttons[0]?.dataset.collapsed).toBe("false");
    expect(buttons[1]?.dataset.collapsed).toBe("false");
    fireEvent.click(buttons[0] as HTMLElement);
    expect(buttons[0]?.dataset.collapsed).toBe("true");
    expect(buttons[1]?.dataset.collapsed).toBe("true");
  });
});
