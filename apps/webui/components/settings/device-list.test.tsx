import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

beforeEach(() => {
  vi.resetModules();
  if (typeof window !== "undefined") {
    window.localStorage.clear();
  }
});

afterEach(() => cleanup());

async function renderDeviceList(): Promise<typeof import("./device-list")["DeviceList"]> {
  const mod = await import("./device-list");
  return mod.DeviceList;
}

describe("DeviceList", () => {
  it("renders empty state when there are no devices", async () => {
    const DeviceList = await renderDeviceList();
    render(<DeviceList />);
    expect(screen.getByText(/no devices yet/i)).toBeTruthy();
  });

  it("renders configured devices with link and delete control", async () => {
    window.localStorage.setItem(
      "scorel:webui:v1:devices",
      JSON.stringify([
        {
          id: "id-1",
          name: "Workstation",
          link: "wss://localhost:9876",
          token: "abc",
          createdAt: 1,
        },
      ])
    );
    const DeviceList = await renderDeviceList();
    render(<DeviceList />);
    expect(screen.getByText("Workstation")).toBeTruthy();
    expect(screen.getByText("wss://localhost:9876")).toBeTruthy();
    const link = screen.getByText("Workstation") as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("/settings/devices/id-1");
    expect(screen.getByText("Delete")).toBeTruthy();
  });
});
