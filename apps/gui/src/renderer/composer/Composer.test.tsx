// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Composer } from "./Composer.js";

let root: Root | undefined;
let container: HTMLDivElement | undefined;

afterEach(() => {
  if (root) {
    act(() => {
      root?.unmount();
    });
  }
  root = undefined;
  container?.remove();
  container = undefined;
  vi.restoreAllMocks();
});

describe("Composer", () => {
  it("does not submit or prevent default while an IME composition is active", async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const onSubmit = vi.fn();

    const textarea = await renderComposer({ onSubmit });

    const enter = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    await act(async () => {
      textarea.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
      textarea.dispatchEvent(enter);
    });

    expect(onSubmit).not.toHaveBeenCalled();
    expect(enter.defaultPrevented).toBe(false);
  });

  it("submits and prevents default on plain Enter", async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const onSubmit = vi.fn();

    const textarea = await renderComposer({ onSubmit });

    const enter = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    await act(async () => {
      textarea.dispatchEvent(enter);
    });

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(enter.defaultPrevented).toBe(true);
  });

  it("keeps Shift Enter available for newline input", async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const onSubmit = vi.fn();

    const textarea = await renderComposer({ onSubmit });

    const shiftEnter = new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true, cancelable: true });
    await act(async () => {
      textarea.dispatchEvent(shiftEnter);
    });

    expect(onSubmit).not.toHaveBeenCalled();
    expect(shiftEnter.defaultPrevented).toBe(false);
  });
});

async function renderComposer(input: { onSubmit: () => void; inFlight?: boolean }): Promise<HTMLTextAreaElement> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);

  await act(async () => {
    root!.render(
      <Composer
        value="ni"
        onChange={vi.fn()}
        onSubmit={input.onSubmit}
        disabled={false}
        inFlight={input.inFlight ?? false}
      />,
    );
  });

  return container.querySelector("textarea") as HTMLTextAreaElement;
}
