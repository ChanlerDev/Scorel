"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import type { DaemonClient } from "@scorel/client";
import type { DirectoryListing, HostProject } from "@scorel/protocol";

import type { Device } from "../../lib/domain/devices";
import { getConnectionPool } from "../../lib/connection/use-connection";

export type ProjectBrowserClient = Pick<
  DaemonClient,
  "listDirectories" | "registerProject" | "listProjects"
>;

type ResolvedDialogClient = {
  client: ProjectBrowserClient;
  release?: () => void;
};

export type AddProjectDialogRegistered = {
  deviceId: string;
  client: ProjectBrowserClient;
  project: HostProject;
};

export type AddProjectDialogProps = {
  open: boolean;
  devices: Device[];
  initialDeviceId?: string;
  onClose(): void;
  onRegistered(args: AddProjectDialogRegistered): Promise<void> | void;
  resolveClient?(device: Device): Promise<ResolvedDialogClient>;
};

function formatError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

async function resolveConnectedClient(
  device: Device,
): Promise<ResolvedDialogClient> {
  const pool = getConnectionPool();
  const connected = pool.peekClient(device.id);
  if (connected) {
    return { client: connected };
  }

  const managed = pool.acquire(device);
  const release = () => pool.release(device.id);

  try {
    if (managed.state.name !== "connected") {
      await managed.connect();
    }
    return {
      client: managed.client,
      release,
    };
  } catch (error) {
    release?.();
    throw error;
  }
}

function CloseIcon(): JSX.Element {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
    >
      <path d="M3.5 3.5l9 9" />
      <path d="M12.5 3.5l-9 9" />
    </svg>
  );
}

function ChevronDownIcon(): JSX.Element {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3.5 6.5 8 11l4.5-4.5" />
    </svg>
  );
}

function HostIcon(): JSX.Element {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="8" cy="8" r="5.5" />
      <path d="M2.8 8h10.4" />
      <path d="M8 2.5c1.9 1.7 2.9 3.5 2.9 5.5S9.9 11.8 8 13.5" />
      <path d="M8 2.5C6.1 4.2 5.1 6 5.1 8S6.1 11.8 8 13.5" />
    </svg>
  );
}

function ParentDirectoryIcon(): JSX.Element {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M6.5 5 3.5 8l3 3" />
      <path d="M4 8h6.5a2.5 2.5 0 0 1 0 5H9.5" />
    </svg>
  );
}

function FolderIcon(): JSX.Element {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M1.75 4.75A1.75 1.75 0 0 1 3.5 3h2.15a1 1 0 0 1 .7.29l1.02 1.02a1 1 0 0 0 .7.29h4.43a1.75 1.75 0 0 1 1.75 1.75v4.9A1.75 1.75 0 0 1 12.5 13H3.5a1.75 1.75 0 0 1-1.75-1.75z" />
    </svg>
  );
}

export function AddProjectDialog({
  open,
  devices,
  initialDeviceId,
  onClose,
  onRegistered,
  resolveClient = resolveConnectedClient,
}: AddProjectDialogProps): JSX.Element | null {
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>();
  const [listing, setListing] = useState<DirectoryListing | null>(null);
  const [pathInput, setPathInput] = useState("");
  const [selectedEntryPath, setSelectedEntryPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [registering, setRegistering] = useState(false);

  const clientRef = useRef<ResolvedDialogClient | null>(null);
  const requestSeqRef = useRef(0);

  const selectedDevice = useMemo(
    () => devices.find((device) => device.id === selectedDeviceId),
    [devices, selectedDeviceId],
  );
  const registerPath = selectedEntryPath ?? pathInput.trim();

  function releaseClient(): void {
    clientRef.current?.release?.();
    clientRef.current = null;
  }

  async function loadListing(path?: string): Promise<void> {
    const handle = clientRef.current;
    if (!handle) return;
    const seq = ++requestSeqRef.current;
    setLoading(true);
    setError(null);
    try {
      const next = await handle.client.listDirectories(path);
      if (seq !== requestSeqRef.current) return;
      setListing(next);
      setPathInput(next.path);
      setSelectedEntryPath(null);
    } catch (nextError) {
      if (seq !== requestSeqRef.current) return;
      setError(formatError(nextError));
    } finally {
      if (seq === requestSeqRef.current) {
        setLoading(false);
      }
    }
  }

  useEffect(() => {
    if (!open) {
      setSelectedDeviceId(undefined);
      setListing(null);
      setPathInput("");
      setSelectedEntryPath(null);
      setError(null);
      setLoading(false);
      setRegistering(false);
      releaseClient();
      return;
    }

    const initial =
      initialDeviceId && devices.some((device) => device.id === initialDeviceId)
        ? initialDeviceId
        : devices[0]?.id;
    setSelectedDeviceId(initial);
    setListing(null);
    setPathInput("");
    setSelectedEntryPath(null);
    setError(null);
    setLoading(false);
    setRegistering(false);
  }, [open, devices, initialDeviceId]);

  useEffect(() => {
    if (!open || !selectedDevice) return;

    let cancelled = false;
    const seq = ++requestSeqRef.current;
    setListing(null);
    setPathInput("");
    setSelectedEntryPath(null);
    setError(null);
    setLoading(true);
    releaseClient();

    void (async () => {
      try {
        const resolved = await resolveClient(selectedDevice);
        if (cancelled) {
          resolved.release?.();
          return;
        }
        clientRef.current = resolved;
        const next = await resolved.client.listDirectories();
        if (cancelled || seq !== requestSeqRef.current) return;
        setListing(next);
        setPathInput(next.path);
        setSelectedEntryPath(null);
      } catch (nextError) {
        if (cancelled || seq !== requestSeqRef.current) return;
        setError(formatError(nextError));
      } finally {
        if (!cancelled && seq === requestSeqRef.current) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      releaseClient();
    };
  }, [open, resolveClient, selectedDevice]);

  useEffect(() => () => releaseClient(), []);

  async function handleBrowsePath(): Promise<void> {
    const nextPath = pathInput.trim();
    if (!nextPath) return;
    setSelectedEntryPath(null);
    await loadListing(nextPath);
  }

  async function handleRegister(): Promise<void> {
    const handle = clientRef.current;
    if (!selectedDevice || !handle || !registerPath) return;
    setRegistering(true);
    setError(null);
    try {
      const project = await handle.client.registerProject(registerPath);
      await onRegistered({
        deviceId: selectedDevice.id,
        client: handle.client,
        project,
      });
      onClose();
    } catch (nextError) {
      setError(formatError(nextError));
    } finally {
      setRegistering(false);
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex overflow-y-auto bg-black/55 px-4 py-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-project-dialog-title"
      data-testid="add-project-dialog"
    >
      <div className="m-auto flex w-full max-w-[760px] flex-col overflow-hidden rounded-[24px] border border-subtle bg-surface shadow-lg">
        <div className="flex items-start justify-between gap-4 px-6 pb-2 pt-6">
          <div className="space-y-2">
            <h2
              id="add-project-dialog-title"
              className="text-[2.25rem] font-semibold tracking-tight text-text"
            >
              添加项目
            </h2>
            <p className="max-w-xl text-sm leading-6 text-muted">
              选择已连接设备，并将当前目录注册为侧边栏中的独立项目。
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="rounded-full p-2 text-muted transition hover:bg-surface-hover hover:text-text"
          >
            <CloseIcon />
          </button>
        </div>

        {devices.length === 0 ? (
          <div className="px-6 pb-6 pt-3 text-sm text-text">
            <div className="rounded-[20px] border border-dashed border-subtle bg-surface-raised px-5 py-6">
              <p>还没有可用设备，先去 Settings 添加 Device。</p>
              <Link
                href="/settings"
                className="mt-4 inline-flex rounded-full bg-accent px-4 py-2 text-sm text-bg hover:bg-accent-hover"
              >
                打开 Settings
              </Link>
            </div>
          </div>
        ) : selectedDevice ? (
          <div className="flex flex-1 flex-col px-6 pb-6 pt-3">
            <div className="space-y-5">
              <div className="space-y-2">
                <label
                  htmlFor="add-project-device-select"
                  className="block text-sm font-medium text-text"
                >
                  目标设备
                </label>
                <div className="relative">
                  <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-faint">
                    <HostIcon />
                  </span>
                  <select
                    id="add-project-device-select"
                    data-testid="add-project-device-select"
                    value={selectedDevice.id}
                    onChange={(event) => setSelectedDeviceId(event.target.value)}
                    disabled={devices.length <= 1}
                    className="w-full appearance-none rounded-[18px] border border-subtle bg-surface-raised py-3 pl-11 pr-12 text-base text-text outline-none transition focus-visible:border-border-strong disabled:cursor-default"
                  >
                    {devices.map((device) => (
                      <option key={device.id} value={device.id}>
                        {device.name}
                      </option>
                    ))}
                  </select>
                  <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-faint">
                    <ChevronDownIcon />
                  </span>
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium text-text">
                    文件夹路径
                  </p>
                  <p className="text-xs text-faint">
                    单击选择，双击进入目录
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    aria-label="上一级"
                    title="上一级"
                    onClick={() => {
                      if (!listing?.parentPath) return;
                      setPathInput(listing.parentPath);
                      void loadListing(listing.parentPath);
                    }}
                    disabled={!listing?.parentPath || loading || registering}
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted transition hover:bg-surface-hover hover:text-text disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <ParentDirectoryIcon />
                  </button>
                  <input
                    id="add-project-dialog-path-input"
                    data-testid="add-project-dialog-path-input"
                    type="text"
                    value={pathInput}
                    onChange={(event) => {
                      setPathInput(event.target.value);
                      setSelectedEntryPath(null);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void handleBrowsePath();
                      }
                    }}
                    className="min-w-0 flex-1 rounded-[18px] border border-subtle bg-surface-raised px-4 py-3 font-mono text-sm text-text outline-none transition focus-visible:border-border-strong"
                  />
                </div>
              </div>
            </div>

            {error ? (
              <div
                data-testid="add-project-dialog-error"
                className="mt-4 rounded-[18px] border border-status-err bg-surface-raised px-4 py-3 text-sm text-status-err"
              >
                {error}
              </div>
            ) : null}

            <div
              data-testid="add-project-directory-panel"
              className="mt-4 h-[320px] overflow-hidden rounded-[20px] border border-subtle bg-surface-raised"
            >
              {loading ? (
                <div
                  data-testid="add-project-dialog-loading"
                  className="flex h-full items-center justify-center px-6 text-sm text-muted"
                >
                  加载目录中...
                </div>
              ) : listing ? (
                listing.entries.length === 0 ? (
                  <div className="flex h-full items-center justify-center px-6 text-sm italic text-muted">
                    当前目录下没有可浏览的子目录。
                  </div>
                ) : (
                  <ul
                    data-testid="add-project-directory-list"
                    className="h-full overflow-y-auto px-2 py-2"
                  >
                    {listing.entries.map((entry) => {
                      const isSelected = entry.path === selectedEntryPath;
                      return (
                        <li key={entry.path}>
                          <button
                            type="button"
                            aria-selected={isSelected}
                            onClick={() => {
                              setSelectedEntryPath(entry.path);
                              setPathInput(entry.path);
                            }}
                            onDoubleClick={() => {
                              setPathInput(entry.path);
                              void loadListing(entry.path);
                            }}
                            className={`flex w-full items-center gap-3 rounded-[16px] px-4 py-3 text-left text-sm text-text transition hover:bg-surface-hover ${
                              isSelected ? "bg-surface-hover" : ""
                            }`}
                          >
                            <span className="shrink-0 text-faint">
                              <FolderIcon />
                            </span>
                            <span className="min-w-0 truncate">{entry.name}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )
              ) : (
                <div className="flex h-full items-center justify-center px-6 text-sm text-muted">
                  选择设备后开始浏览目录。
                </div>
              )}
            </div>

            <p className="mt-3 text-sm text-muted">
              此目录会作为独立项目显示在侧边栏中。
            </p>

            <div className="mt-6 flex items-center justify-end gap-4">
              <button
                type="button"
                onClick={onClose}
                className="rounded-full px-4 py-2 text-base text-muted transition hover:text-text"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => void handleRegister()}
                disabled={!registerPath || loading || registering}
                className="rounded-full bg-accent px-6 py-3 text-base font-medium text-bg transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
              >
                {registering ? "添加中..." : "添加项目"}
              </button>
            </div>
          </div>
        ) : (
          <div className="px-6 pb-6 pt-3 text-sm text-muted">
            选择设备后开始浏览目录。
          </div>
        )}
      </div>
    </div>
  );
}
