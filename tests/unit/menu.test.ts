import { beforeEach, describe, expect, it, vi } from "vitest";

const { buildFromTemplate } = vi.hoisted(() => ({
  buildFromTemplate: vi.fn((template) => ({ template })),
}));

vi.mock("electron", () => ({
  app: { name: "Scorel" },
  Menu: {
    buildFromTemplate,
  },
}));

import { buildAppMenu } from "../../src/main/menu.js";

describe("buildAppMenu", () => {
  beforeEach(() => {
    buildFromTemplate.mockClear();
  });

  it("builds a menu with the expected keyboard shortcuts", () => {
    const send = vi.fn();
    buildAppMenu(() => ({ webContents: { send } } as never));

    expect(buildFromTemplate).toHaveBeenCalledTimes(1);
    const [template] = buildFromTemplate.mock.calls[0] as [Array<{
      label?: string;
      submenu?: Array<{ label?: string; accelerator?: string }>;
    }>];

    const fileMenu = template.find((item) => item.label === "File");
    expect(fileMenu?.submenu?.some((item) => item.label === "New Chat" && item.accelerator === "CmdOrCtrl+N")).toBe(true);
  });

  it("wires the New Chat menu item to the renderer event", () => {
    const send = vi.fn();
    buildAppMenu(() => ({ webContents: { send } } as never));

    const [template] = buildFromTemplate.mock.calls[0] as [Array<{
      label?: string;
      submenu?: Array<{ label?: string; click?: () => void }>;
    }>];

    const fileMenu = template.find((item) => item.label === "File");
    const newChatItem = fileMenu?.submenu?.find((item) => item.label === "New Chat");

    newChatItem?.click?.();

    expect(send).toHaveBeenCalledWith("menu:new-session");
  });

  it("includes the standard application menu sections", () => {
    buildAppMenu(() => null);

    const [template] = buildFromTemplate.mock.calls[0] as [Array<{ label?: string }>];

    expect(template.map((item) => item.label)).toEqual([
      "Scorel",
      "File",
      "Edit",
      "View",
      "Window",
    ]);
  });

  it("does not throw when the main window is unavailable", () => {
    buildAppMenu(() => null);

    const [template] = buildFromTemplate.mock.calls[0] as [Array<{
      label?: string;
      submenu?: Array<{ label?: string; click?: () => void }>;
    }>];

    const fileMenu = template.find((item) => item.label === "File");
    const newChatItem = fileMenu?.submenu?.find((item) => item.label === "New Chat");

    expect(() => newChatItem?.click?.()).not.toThrow();
  });
});
