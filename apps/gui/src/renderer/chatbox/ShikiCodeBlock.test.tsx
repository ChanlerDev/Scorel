// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import ShikiCodeBlock from "./ShikiCodeBlock.js";

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

describe("ShikiCodeBlock", () => {
  it("renders a code-block header with language and copy controls", async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root!.render(<ShikiCodeBlock lang="text" code={"client USER_CHANGES\n  -> editroom"} />);
    });

    const language = container.querySelector(".shiki-block__lang") as HTMLElement | null;
    const copy = container.querySelector(".shiki-block__copy") as HTMLButtonElement | null;
    expect(language?.textContent).toBe("text");
    expect(language?.tagName.toLowerCase()).toBe("span");
    expect(copy?.textContent).toContain("Copy");

    await act(async () => {
      copy?.click();
    });
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenLastCalledWith("client USER_CHANGES\n  -> editroom");
  });
});
