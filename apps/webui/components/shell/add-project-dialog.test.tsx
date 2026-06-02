import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { asProjectId, type HostProject } from "@scorel/protocol";

import type { Device } from "../../lib/domain/devices";
import {
  AddProjectDialog,
  type AddProjectDialogRegistered,
  type ProjectBrowserClient,
} from "./add-project-dialog";

function makeDevice(overrides: Partial<Device> = {}): Device {
  return {
    id: overrides.id ?? "device-1",
    name: overrides.name ?? "Tokyo",
    link: overrides.link ?? "wss://host.test",
    token: overrides.token ?? "secret",
    createdAt: overrides.createdAt ?? 1,
    ...overrides,
  };
}

function makeProject(projectId = "project-1"): HostProject {
  return {
    projectId: asProjectId(projectId),
    displayName: projectId,
    workDir: `/work/${projectId}`,
    createdAt: 1,
    updatedAt: 1,
  };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

type StubClient = {
  listDirectories: ReturnType<typeof vi.fn>;
  registerProject: ReturnType<typeof vi.fn>;
  listProjects: ReturnType<typeof vi.fn>;
};

function makeClient(): StubClient {
  return {
    listDirectories: vi.fn(),
    registerProject: vi.fn(),
    listProjects: vi.fn(),
  };
}

beforeEach(() => {
  if (typeof window !== "undefined") {
    window.localStorage.clear();
  }
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("AddProjectDialog", () => {
  it("shows Settings guidance when there are no devices", () => {
    const onRegistered = vi.fn();
    const resolveClient = vi.fn();

    render(
      <AddProjectDialog
        open
        devices={[]}
        onClose={vi.fn()}
        onRegistered={onRegistered}
        resolveClient={resolveClient}
      />,
    );

    expect(screen.getByText(/先去 Settings 添加 Device/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "打开 Settings" })).toBeTruthy();
    expect(resolveClient).not.toHaveBeenCalled();
    expect(onRegistered).not.toHaveBeenCalled();
  });

  it("with one device, enters directory browsing immediately", async () => {
    const device = makeDevice();
    const client = makeClient();
    client.listDirectories.mockResolvedValue({
      path: "/repo",
      entries: [],
    });
    const resolveClient = vi.fn().mockResolvedValue({ client });

    render(
      <AddProjectDialog
        open
        devices={[device]}
        onClose={vi.fn()}
        onRegistered={vi.fn()}
        resolveClient={resolveClient}
      />,
    );

    expect(screen.getByTestId("add-project-dialog-loading")).toBeTruthy();
    await screen.findByDisplayValue("/repo");
    const select = screen.getByTestId(
      "add-project-device-select",
    ) as HTMLSelectElement;
    expect(select.value).toBe(device.id);
    expect(select.disabled).toBe(true);
    expect(resolveClient).toHaveBeenCalledWith(device);
    expect(client.listDirectories.mock.calls[0]?.length ?? 0).toBe(0);
  });

  it("renders the current path in an editable input and keeps the directory list scrollable", async () => {
    const longPath =
      "/very/long/workspace/path/that/should/not/stretch/the/dialog/layout/beyond/the/viewport/repo";
    const client = makeClient();
    client.listDirectories.mockResolvedValue({
      path: longPath,
      entries: [{ name: "repo", path: "/child", kind: "directory" }],
    });

    render(
      <AddProjectDialog
        open
        devices={[makeDevice()]}
        onClose={vi.fn()}
        onRegistered={vi.fn()}
        resolveClient={vi.fn().mockResolvedValue({ client })}
      />,
    );

    const pathInput = (await screen.findByTestId(
      "add-project-dialog-path-input",
    )) as HTMLInputElement;
    expect(pathInput.value).toBe(longPath);
    expect(pathInput.tagName).toBe("INPUT");
    expect(
      screen.getByTestId("add-project-directory-list").className,
    ).toContain("overflow-y-auto");
  });

  it("with multiple devices, shows a device selector above the directory list", async () => {
    const alpha = makeDevice({ id: "a", name: "Alpha" });
    const beta = makeDevice({ id: "b", name: "Beta" });
    const alphaClient = makeClient();
    alphaClient.listDirectories.mockResolvedValue({
      path: "/alpha",
      entries: [],
    });
    const betaClient = makeClient();
    betaClient.listDirectories.mockResolvedValue({
      path: "/beta",
      entries: [],
    });
    const resolveClient = vi.fn(async (device: Device) => ({
      client:
        (device.id === "a" ? alphaClient : betaClient) as unknown as ProjectBrowserClient,
    }));

    render(
      <AddProjectDialog
        open
        devices={[alpha, beta]}
        onClose={vi.fn()}
        onRegistered={vi.fn()}
        resolveClient={resolveClient}
      />,
    );

    await screen.findByDisplayValue("/alpha");
    const select = screen.getByTestId(
      "add-project-device-select",
    ) as HTMLSelectElement;
    expect(select.value).toBe("a");
    expect(select.disabled).toBe(false);
    fireEvent.change(select, { target: { value: "b" } });
    await screen.findByDisplayValue("/beta");
    expect(resolveClient).toHaveBeenNthCalledWith(1, alpha);
    expect(resolveClient).toHaveBeenCalledWith(beta);
  });

  it("prefers the provided initialDeviceId when opening", async () => {
    const alpha = makeDevice({ id: "a", name: "Alpha" });
    const beta = makeDevice({ id: "b", name: "Beta" });
    const alphaClient = makeClient();
    alphaClient.listDirectories.mockResolvedValue({
      path: "/alpha",
      entries: [],
    });
    const betaClient = makeClient();
    betaClient.listDirectories.mockResolvedValue({
      path: "/beta",
      entries: [],
    });
    const resolveClient = vi.fn(async (device: Device) => ({
      client:
        (device.id === "a" ? alphaClient : betaClient) as unknown as ProjectBrowserClient,
    }));

    render(
      <AddProjectDialog
        open
        devices={[alpha, beta]}
        initialDeviceId="b"
        onClose={vi.fn()}
        onRegistered={vi.fn()}
        resolveClient={resolveClient}
      />,
    );

    await screen.findByDisplayValue("/beta");
    const select = screen.getByTestId(
      "add-project-device-select",
    ) as HTMLSelectElement;
    expect(select.value).toBe("b");
    expect(resolveClient).toHaveBeenCalledTimes(1);
    expect(resolveClient).toHaveBeenCalledWith(beta);
  });

  it("renders loading first, then empty directory state", async () => {
    const listing = deferred<{
      path: string;
      parentPath?: string;
      entries: Array<{ name: string; path: string; kind: "directory" }>;
    }>();
    const client = makeClient();
    client.listDirectories.mockReturnValue(listing.promise);

    render(
      <AddProjectDialog
        open
        devices={[makeDevice()]}
        onClose={vi.fn()}
        onRegistered={vi.fn()}
        resolveClient={vi.fn().mockResolvedValue({ client })}
      />,
    );

    expect(screen.getByTestId("add-project-dialog-loading")).toBeTruthy();
    listing.resolve({ path: "/empty", entries: [] });
    await screen.findByText(/当前目录下没有可浏览的子目录/);
  });

  it("shows filesystem errors while keeping the dialog open", async () => {
    const client = makeClient();
    client.listDirectories.mockRejectedValue(new Error("filesystem_error"));

    render(
      <AddProjectDialog
        open
        devices={[makeDevice()]}
        onClose={vi.fn()}
        onRegistered={vi.fn()}
        resolveClient={vi.fn().mockResolvedValue({ client })}
      />,
    );

    await screen.findByTestId("add-project-dialog-error");
    expect(screen.getByText("filesystem_error")).toBeTruthy();
    expect(screen.getByTestId("add-project-dialog")).toBeTruthy();
  });

  it("single click selects a child directory path without navigating", async () => {
    const client = makeClient();
    client.listDirectories.mockResolvedValue({
      path: "/root",
      entries: [{ name: "repo", path: "/real/child", kind: "directory" }],
    });

    render(
      <AddProjectDialog
        open
        devices={[makeDevice()]}
        onClose={vi.fn()}
        onRegistered={vi.fn()}
        resolveClient={vi.fn().mockResolvedValue({ client })}
      />,
    );

    await screen.findByDisplayValue("/root");
    fireEvent.click(screen.getByRole("button", { name: /repo/ }));
    const pathInput = screen.getByTestId(
      "add-project-dialog-path-input",
    ) as HTMLInputElement;
    expect(pathInput.value).toBe("/real/child");
    expect(
      screen.getByRole("button", { name: /repo/ }).getAttribute("aria-selected"),
    ).toBe("true");
    expect(client.listDirectories).toHaveBeenCalledTimes(1);
  });

  it("double click navigates into a child directory using the host-returned child path", async () => {
    const client = makeClient();
    client.listDirectories
      .mockResolvedValueOnce({
        path: "/root",
        entries: [{ name: "repo", path: "/real/child", kind: "directory" }],
      })
      .mockResolvedValueOnce({
        path: "/real/child",
        parentPath: "/root",
        entries: [],
      });

    render(
      <AddProjectDialog
        open
        devices={[makeDevice()]}
        onClose={vi.fn()}
        onRegistered={vi.fn()}
        resolveClient={vi.fn().mockResolvedValue({ client })}
      />,
    );

    await screen.findByDisplayValue("/root");
    fireEvent.doubleClick(screen.getByRole("button", { name: /repo/ }));
    await screen.findByDisplayValue("/real/child");
    expect(client.listDirectories).toHaveBeenNthCalledWith(2, "/real/child");
  });

  it("navigates to the parent directory using parentPath", async () => {
    const client = makeClient();
    client.listDirectories
      .mockResolvedValueOnce({
        path: "/root/child",
        parentPath: "/real/parent",
        entries: [],
      })
      .mockResolvedValueOnce({
        path: "/real/parent",
        entries: [],
      });

    render(
      <AddProjectDialog
        open
        devices={[makeDevice()]}
        onClose={vi.fn()}
        onRegistered={vi.fn()}
        resolveClient={vi.fn().mockResolvedValue({ client })}
      />,
    );

    await screen.findByDisplayValue("/root/child");
    fireEvent.click(screen.getByRole("button", { name: "上一级" }));
    await screen.findByDisplayValue("/real/parent");
    expect(client.listDirectories).toHaveBeenNthCalledWith(2, "/real/parent");
  });

  it("pressing enter in the path input browses that exact host path", async () => {
    const client = makeClient();
    client.listDirectories
      .mockResolvedValueOnce({
        path: "/root",
        entries: [],
      })
      .mockResolvedValueOnce({
        path: "/manual/path",
        entries: [],
      });

    render(
      <AddProjectDialog
        open
        devices={[makeDevice()]}
        onClose={vi.fn()}
        onRegistered={vi.fn()}
        resolveClient={vi.fn().mockResolvedValue({ client })}
      />,
    );

    const pathInput = (await screen.findByTestId(
      "add-project-dialog-path-input",
    )) as HTMLInputElement;
    fireEvent.change(pathInput, { target: { value: "/manual/path" } });
    fireEvent.keyDown(pathInput, { key: "Enter", code: "Enter" });
    await screen.findByDisplayValue("/manual/path");
    expect(client.listDirectories).toHaveBeenNthCalledWith(2, "/manual/path");
  });

  it("registers the current directory and returns the project to the caller", async () => {
    const device = makeDevice();
    const client = makeClient();
    const project = makeProject("existing-project");
    client.listDirectories.mockResolvedValue({
      path: "/work/existing-project",
      entries: [],
    });
    client.registerProject.mockResolvedValue(project);
    const onRegistered = vi.fn<
      (value: AddProjectDialogRegistered) => Promise<void>
    >().mockResolvedValue();
    const onClose = vi.fn();

    render(
      <AddProjectDialog
        open
        devices={[device]}
        onClose={onClose}
        onRegistered={onRegistered}
        resolveClient={vi.fn().mockResolvedValue({
          client: client as unknown as ProjectBrowserClient,
        })}
      />,
    );

    await screen.findByDisplayValue("/work/existing-project");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "添加项目" }));
    });

    expect(client.registerProject).toHaveBeenCalledWith("/work/existing-project");
    expect(onRegistered).toHaveBeenCalledWith({
      deviceId: device.id,
      client,
      project,
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("registers the single-click selected directory path", async () => {
    const client = makeClient();
    const project = makeProject("selected-project");
    client.listDirectories.mockResolvedValue({
      path: "/root",
      entries: [{ name: "repo", path: "/real/child", kind: "directory" }],
    });
    client.registerProject.mockResolvedValue(project);

    render(
      <AddProjectDialog
        open
        devices={[makeDevice()]}
        onClose={vi.fn()}
        onRegistered={vi.fn()}
        resolveClient={vi.fn().mockResolvedValue({ client })}
      />,
    );

    await screen.findByDisplayValue("/root");
    fireEvent.click(screen.getByRole("button", { name: /repo/ }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "添加项目" }));
    });

    expect(client.registerProject).toHaveBeenCalledWith("/real/child");
  });

  it("keeps the dialog open and shows the registration error", async () => {
    const client = makeClient();
    client.listDirectories.mockResolvedValue({
      path: "/work/repo",
      entries: [],
    });
    client.registerProject.mockRejectedValue(new Error("register failed"));

    render(
      <AddProjectDialog
        open
        devices={[makeDevice()]}
        onClose={vi.fn()}
        onRegistered={vi.fn()}
        resolveClient={vi.fn().mockResolvedValue({ client })}
      />,
    );

    await screen.findByDisplayValue("/work/repo");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "添加项目" }));
    });

    expect(screen.getByTestId("add-project-dialog")).toBeTruthy();
    expect(screen.getByTestId("add-project-dialog-error").textContent).toBe(
      "register failed",
    );
  });
});
