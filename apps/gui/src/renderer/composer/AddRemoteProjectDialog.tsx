import type { DirectoryListing } from "@scorel/protocol";
import { useEffect, useState } from "react";

import { Folder, RotateCcw, X } from "../icons/index.js";
import type { GuiRelayDeviceView, GuiRemoteProjectView } from "../../shared/ipc.js";

export type AddRemoteProjectDialogProps = {
  devices: GuiRelayDeviceView[];
  initialDeviceId?: string;
  onClose(): void;
  onSubmitted(project: GuiRemoteProjectView): void;
  setError(message: string | null): void;
};

export function AddRemoteProjectDialog({
  devices,
  initialDeviceId,
  onClose,
  onSubmitted,
  setError,
}: AddRemoteProjectDialogProps) {
  const [deviceId, setDeviceId] = useState<string>(initialDeviceId ?? devices[0]?.deviceId ?? "");
  const [path, setPath] = useState<string>("");
  const [listing, setListing] = useState<DirectoryListing | null>(null);
  const [busy, setBusy] = useState<boolean>(false);

  useEffect(() => {
    if (!deviceId) return;
    void browse("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceId]);

  const browse = async (input: string): Promise<void> => {
    if (!deviceId) return;
    setBusy(true);
    try {
      const next = await window.scorel.listRemoteDirectories(deviceId, input || undefined);
      setListing(next);
      setPath(next.path);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const handleAdd = async (): Promise<void> => {
    if (!deviceId || !path) return;
    setBusy(true);
    try {
      const project = await window.scorel.addRemoteProject(deviceId, path);
      onSubmitted(project);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal" onMouseDown={onClose} role="dialog" aria-label="Add remote project">
      <div className="modal__panel" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal__header">
          <h2 className="modal__title">添加远程项目</h2>
          <button type="button" className="modal__icon-button" onClick={onClose} aria-label="Close">
            <X size={14} />
          </button>
        </div>
        <p className="modal__subtitle">选择已连接的远程主机,并输入此项目的文件夹。</p>
        <div className="modal__field">
          <label className="modal__label" htmlFor="add-remote-device">远程主机</label>
          <div className="modal__input">
            <select
              id="add-remote-device"
              value={deviceId}
              onChange={(event) => setDeviceId(event.currentTarget.value)}
            >
              {devices.length === 0 ? (
                <option value="">还没有 Relay 设备</option>
              ) : (
                devices.map((device) => (
                  <option key={device.deviceId} value={device.deviceId}>
                    {device.label} ({device.online ? "online" : "offline"})
                  </option>
                ))
              )}
            </select>
            <span />
          </div>
        </div>
        <div className="modal__field">
          <label className="modal__label" htmlFor="add-remote-path">文件夹路径</label>
          <div className="modal__input">
            <input
              id="add-remote-path"
              value={path}
              placeholder="/path/to/project"
              onChange={(event) => setPath(event.currentTarget.value)}
              data-testid="remote-path"
            />
            <button
              type="button"
              className="modal__icon-button"
              onClick={() => void browse("")}
              aria-label="Reset"
              disabled={busy || !deviceId}
            >
              <RotateCcw size={14} />
            </button>
          </div>
        </div>
        {listing ? (
          <div className="modal__directory-list">
            {listing.entries.length === 0 ? (
              <div className="modal__hint">空目录</div>
            ) : (
              listing.entries.map((entry) => (
                <button
                  key={entry.path}
                  type="button"
                  onClick={() => void browse(entry.path)}
                  disabled={busy}
                >
                  <Folder />
                  <span>{entry.name}</span>
                </button>
              ))
            )}
          </div>
        ) : (
          <div className="modal__hint">{deviceId ? "Browse a remote path" : "Refresh a Relay Device first"}</div>
        )}
        <p className="modal__hint">此远程文件夹将作为单独项目显示在侧边栏中。</p>
        <div className="modal__footer">
          <button type="button" className="button button--ghost" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="button button--primary"
            onClick={() => void handleAdd()}
            disabled={busy || !deviceId || !path}
          >
            添加项目
          </button>
        </div>
      </div>
    </div>
  );
}
