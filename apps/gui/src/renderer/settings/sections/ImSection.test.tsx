// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { GuiExtensionSettingsView } from "../../../shared/ipc.js";
import { ImSection } from "./ImSection.js";

const STORAGE_KEY = "scorel.settings.im.openPlatform";
const noop = (): void => {};

const extensions: Record<string, GuiExtensionSettingsView> = {
  telegram: {
    extensionId: "telegram",
    enabled: false,
    kind: "im",
    config: { credentialMode: "direct" },
    active: false,
  },
  qq: {
    extensionId: "qq",
    enabled: false,
    kind: "im",
    config: {},
    active: false,
  },
  wechat: {
    extensionId: "wechat",
    enabled: false,
    kind: "im",
    config: {},
    active: false,
  },
};

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
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("ImSection", () => {
  it("starts collapsed, toggles a platform open, and folds it on the second click", async () => {
    const element = await renderImSection();

    expect(element.textContent).not.toContain("Telegram Bot 配置");

    await act(async () => {
      buttonByName(element, "Telegram").click();
    });
    expect(element.textContent).toContain("Telegram Bot 配置");
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("telegram");

    await act(async () => {
      buttonByName(element, "Telegram").click();
    });
    expect(element.textContent).not.toContain("Telegram Bot 配置");
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("restores the previously expanded platform", async () => {
    window.localStorage.setItem(STORAGE_KEY, "qq");

    const element = await renderImSection();

    expect(element.textContent).toContain("QQ Bot 配置");
    expect(element.textContent).toContain("App Secret");
    expect(element.textContent).toContain("Allowed Conversations");
    expect(element.textContent).not.toContain("Token Env");
    expect(element.textContent).not.toContain("Telegram Bot 配置");
  });

  it("separates WeChat outbound webhook and inbound callback setup fields", async () => {
    window.localStorage.setItem(STORAGE_KEY, "wechat");

    const element = await renderImSection();

    expect(element.textContent).toContain("WeChat 配置");
    expect(element.textContent).toContain("Outbound Webhook");
    expect(element.textContent).toContain("Callback Token");
    expect(element.textContent).toContain("Callback Host");
    expect(element.textContent).toContain("Callback Port");
    expect(element.textContent).not.toContain("Webhook Key Env");
    expect(element.textContent).not.toContain("Webhook Base URL");
  });
});

async function renderImSection(): Promise<HTMLDivElement> {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(window, "scorel", {
    configurable: true,
    value: {
      upsertExtensionSettings: vi.fn(async (input: GuiExtensionSettingsView) => input),
    },
  });

  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);

  await act(async () => {
    root!.render(
      <ImSection
        extensions={extensions}
        busy={false}
        setBusy={noop}
        setError={noop}
        onExtensionChange={noop}
      />,
    );
  });

  return container;
}

function buttonByName(element: HTMLElement, name: string): HTMLButtonElement {
  const button = Array.from(element.querySelectorAll("button")).find((candidate) => candidate.textContent?.includes(name));
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`button not found: ${name}`);
  }
  return button;
}
