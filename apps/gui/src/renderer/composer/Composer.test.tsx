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
  it("shows context usage details in a tooltip while hovered", async () => {
    const element = await renderComposerElement({
      contextUsage: {
        usedTokens: 80_000,
        totalTokens: 100_000,
        autoCompactThreshold: 0.9,
      },
    });

    const indicator = element.querySelector('[data-testid="composer-context-indicator"]') as HTMLDivElement;
    expect(indicator).toBeTruthy();
    expect(indicator.getAttribute("aria-label")).toContain("Context used 80%");
    expect(element.querySelector('[role="tooltip"]')).toBeNull();

    await act(async () => {
      indicator.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    });

    const tooltip = element.querySelector('[role="tooltip"]');
    expect(tooltip?.textContent).toContain("80% 已用（剩余 20%）");
    expect(tooltip?.textContent).toContain("已用 80,000 Token，共 100,000 Token");
    expect(indicator.getAttribute("data-used-percent")).toBe("80");
    expect(indicator.getAttribute("data-threshold-percent")).toBe("90");
    expect(indicator.className).toContain("composer-context--warn");

    await act(async () => {
      indicator.dispatchEvent(new MouseEvent("mouseout", { bubbles: true }));
    });
    expect(element.querySelector('[role="tooltip"]')).toBeNull();
  });

  it("places the context indicator immediately before the send button", async () => {
    const element = await renderComposerElement({
      contextUsage: {
        usedTokens: 20_000,
        totalTokens: 100_000,
        autoCompactThreshold: 0.8,
      },
      models: [{ modelId: "gpt", displayName: "GPT", providerModelId: "gpt", providerId: "openai", provider: "openai", id: "gpt", roles: ["standard"] }],
      selectedModelId: "gpt",
    });

    const controls = Array.from(element.querySelector(".composer__right")?.children ?? []);
    expect(controls.at(-2)?.getAttribute("data-testid")).toBe("composer-context-indicator");
    expect(controls.at(-1)?.getAttribute("aria-label")).toBe("Send");
  });

  it("marks context usage as danger at the auto compact threshold", async () => {
    const element = await renderComposerElement({
      contextUsage: {
        usedTokens: 91_000,
        totalTokens: 100_000,
        autoCompactThreshold: 0.9,
      },
    });

    const indicator = element.querySelector('[data-testid="composer-context-indicator"]') as HTMLDivElement;
    expect(indicator.className).toContain("composer-context--danger");
  });

  it("shows provider usage as unavailable without fabricating a percentage", async () => {
    const element = await renderComposerElement({
      contextUsage: {
        usedTokens: undefined,
        totalTokens: 100_000,
        autoCompactThreshold: 0.9,
      },
    });

    const indicator = element.querySelector('[data-testid="composer-context-indicator"]') as HTMLDivElement;
    expect(indicator).toBeTruthy();
    expect(indicator.className).toContain("composer-context--unavailable");
    expect(indicator.getAttribute("aria-label")).toBe("Context usage unavailable");
    expect(indicator.getAttribute("data-used-percent")).toBeNull();

    await act(async () => {
      indicator.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    });

    const tooltip = element.querySelector('[role="tooltip"]');
    expect(tooltip?.textContent).toContain("暂无 Provider 上下文用量");
    expect(tooltip?.textContent).toContain("上下文窗口共 100,000 Token");
    expect(tooltip?.textContent).not.toContain("0% 已用");
    expect(tooltip?.textContent).not.toContain("已用 0 Token");
  });

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
  const element = await renderComposerElement(input);
  return element.querySelector("textarea") as HTMLTextAreaElement;
}

async function renderComposerElement(input: {
  onSubmit?: () => void;
  inFlight?: boolean;
  contextUsage?: Parameters<typeof Composer>[0]["contextUsage"];
  models?: Parameters<typeof Composer>[0]["models"];
  selectedModelId?: string;
}): Promise<HTMLDivElement> {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);

  await act(async () => {
    root!.render(
      <Composer
        value="ni"
        onChange={vi.fn()}
        onSubmit={input.onSubmit ?? vi.fn()}
        disabled={false}
        inFlight={input.inFlight ?? false}
        contextUsage={input.contextUsage}
        models={input.models}
        selectedModelId={input.selectedModelId}
      />,
    );
  });

  return container;
}
