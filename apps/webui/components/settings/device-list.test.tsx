import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

beforeEach(() => {
  vi.resetModules();
  if (typeof window !== "undefined") {
    window.localStorage.clear();
  }
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const mockNavigation = (push: ReturnType<typeof vi.fn> = vi.fn()) => {
  vi.doMock("next/navigation", () => ({
    useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn(), back: vi.fn(), forward: vi.fn(), prefetch: vi.fn() }),
  }));
  return push;
};

const mockFetch = (response: Response | Promise<Response>) => {
  const fetchSpy = vi.fn(() => Promise.resolve(response));
  (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchSpy as unknown as typeof fetch;
  return fetchSpy;
};

async function renderDeviceList(): Promise<typeof import("./device-list")["DeviceList"]> {
  const mod = await import("./device-list");
  return mod.DeviceList;
}

const detectedResponse = (overrides: Record<string, unknown> = {}): Response =>
  new Response(
    JSON.stringify({
      ok: true,
      wsUrl: "ws://127.0.0.1:7777",
      token: "auto-token",
      host: "127.0.0.1",
      port: 7777,
      ...overrides,
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );

describe("DeviceList", () => {
  it("renders empty state when there are no devices", async () => {
    mockNavigation();
    mockFetch(new Response(null, { status: 404 }));
    const DeviceList = await renderDeviceList();
    render(<DeviceList />);
    expect(screen.getByText(/no devices yet/i)).toBeTruthy();
  });

  it("renders configured devices with link and delete control", async () => {
    mockNavigation();
    mockFetch(new Response(null, { status: 404 }));
    window.localStorage.setItem(
      "scorel:webui:v2:devices",
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

  it("renders the detected-daemon banner when /api/local-daemon returns 200 and no matching device exists", async () => {
    mockNavigation();
    mockFetch(detectedResponse());
    const DeviceList = await renderDeviceList();
    render(<DeviceList />);
    await waitFor(() => expect(screen.getByText(/detected local daemon/i)).toBeTruthy());
    expect(screen.getByText(/ws:\/\/127\.0\.0\.1:7777/)).toBeTruthy();
    expect(screen.getByText("ws://127.0.0.1:7777")).toBeTruthy();
  });

  it("hides the banner when /api/local-daemon returns 404", async () => {
    mockNavigation();
    mockFetch(new Response(null, { status: 404 }));
    const DeviceList = await renderDeviceList();
    render(<DeviceList />);
    // Wait a tick to let the effect resolve.
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(screen.queryByText(/detected local daemon/i)).toBeNull();
  });

  it("hides the banner when an existing device already matches wsUrl + token", async () => {
    mockNavigation();
    mockFetch(detectedResponse());
    window.localStorage.setItem(
      "scorel:webui:v2:devices",
      JSON.stringify([
        {
          id: "id-existing",
          name: "Existing local",
          link: "ws://127.0.0.1:7777",
          token: "auto-token",
          createdAt: 1,
        },
      ]),
    );
    const DeviceList = await renderDeviceList();
    render(<DeviceList />);
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(screen.queryByText(/detected local daemon/i)).toBeNull();
  });

  it("adds the detected device on click and navigates to its route", async () => {
    const push = vi.fn();
    mockNavigation(push);
    mockFetch(detectedResponse());
    const DeviceList = await renderDeviceList();
    render(<DeviceList />);
    const button = await waitFor(() => screen.getByRole("button", { name: /use this device/i }));
    await act(async () => {
      fireEvent.click(button);
    });
    expect(push).toHaveBeenCalledTimes(1);
    expect(String(push.mock.calls[0]?.[0])).toMatch(/^\/devices\//);
  });
});
