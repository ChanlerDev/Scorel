import { useState } from "react";

import type { GuiRelayDeviceView, GuiRelayPairSessionView } from "../../../shared/ipc.js";
import { Pencil } from "../../icons/index.js";
import { SettingsCard } from "../SettingsCard.js";
import { SettingsHeader } from "../SettingsHeader.js";
import { SettingsRow } from "../SettingsRow.js";

const OFFICIAL_RELAY_URL = "wss://scorel-relay.chanler.dev";

export type ConfigSectionProps = {
  devices: GuiRelayDeviceView[];
  busy: boolean;
  setBusy(value: boolean): void;
  setError(message: string | null): void;
  refresh(): Promise<void>;
};

export function ConfigSection({ devices, busy, setBusy, setError, refresh }: ConfigSectionProps) {
  const [relayUrl, setRelayUrl] = useState<string>("");
  const [editingRelayUrl, setEditingRelayUrl] = useState<boolean>(false);
  const [pair, setPair] = useState<GuiRelayPairSessionView | null>(null);
  const [renamingDeviceId, setRenamingDeviceId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState<string>("");

  const effectiveRelayUrl = editingRelayUrl ? relayUrl.trim() || undefined : undefined;

  const handlePair = async (): Promise<void> => {
    setBusy(true);
    try {
      const result = await window.scorel.createRelayPairSession(effectiveRelayUrl);
      setPair(result);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const handleRefresh = async (): Promise<void> => {
    setBusy(true);
    try {
      await window.scorel.refreshRelayDevices(effectiveRelayUrl || pair?.relayUrl || undefined);
      await refresh();
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const startRename = (device: GuiRelayDeviceView): void => {
    setRenamingDeviceId(device.deviceId);
    setRenameValue(device.label);
  };

  const saveRename = async (device: GuiRelayDeviceView): Promise<void> => {
    setBusy(true);
    try {
      await window.scorel.renameRelayDevice(device.deviceId, renameValue);
      setRenamingDeviceId(null);
      await refresh();
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <SettingsHeader
        title="连接"
        subtitle="管理 Relay 设备和远程项目授权。"
      />

      <section className="settings-section">
        <h2 className="settings-section__title">Relay 设备</h2>
        <SettingsCard>
          <SettingsRow
            label="Relay URL"
            description="默认使用官方 Relay；只有自建 Relay 时才需要修改。"
            control={
              <>
                {editingRelayUrl ? (
                  <input
                    className="input-text"
                    placeholder={OFFICIAL_RELAY_URL}
                    value={relayUrl}
                    onChange={(event) => setRelayUrl(event.currentTarget.value)}
                    data-testid="relay-url"
                  />
                ) : (
                  <span className="settings-value">官方 Relay</span>
                )}
                <button
                  type="button"
                  className="button button--ghost button--icon-text"
                  disabled={busy}
                  onClick={() => setEditingRelayUrl((current) => !current)}
                >
                  <Pencil size={13} />
                  <span>{editingRelayUrl ? "完成" : "编辑"}</span>
                </button>
                <button
                  type="button"
                  className="button"
                  disabled={busy}
                  onClick={() => void handlePair()}
                >
                  Get Pair Code
                </button>
              </>
            }
          />
          <SettingsRow
            label="已配对设备"
            description="刷新后显示授权设备列表"
            control={
              <button
                type="button"
                className="button"
                disabled={busy}
                onClick={() => void handleRefresh()}
              >
                Refresh
              </button>
            }
          />
          {pair ? (
            <div style={{ padding: "12px 16px", boxShadow: "inset 0 -1px 0 var(--color-border-hairline)" }}>
              <div className="pair-code">
                <strong>{pair.pairCode}</strong>
                <span>在另一台设备运行 scorel pair {pair.pairCode}</span>
              </div>
            </div>
          ) : null}
          {devices.length === 0 ? (
            <div style={{ padding: "12px 16px", color: "var(--color-text-faint)", fontSize: 13 }}>
              暂无 Relay 设备。点击 Refresh 刷新。
            </div>
          ) : (
            devices.map((device) => (
              <details key={device.deviceId} className="relay-device-row">
                <summary className="relay-device-row__summary">
                  <span className={`project-tree__online${device.online ? "" : " project-tree__online--off"}`} />
                  <span className="relay-device-row__name">{device.label}</span>
                  <span className="relay-device-row__url">{device.relayUrl}</span>
                </summary>
                <div className="relay-device-row__details">
                  <div className="relay-device-row__detail">
                    <span>状态</span>
                    <strong>{device.online ? "Online" : "Offline"}</strong>
                  </div>
                  <div className="relay-device-row__detail">
                    <span>Device ID</span>
                    <strong>{device.deviceId}</strong>
                  </div>
                  <div className="relay-device-row__detail">
                    <span>IP</span>
                    <strong>{device.ip || "未上报"}</strong>
                  </div>
                  <div className="relay-device-row__detail">
                    <span>Relay URL</span>
                    <strong>{device.relayUrl}</strong>
                  </div>
                  <div className="relay-device-row__rename">
                    {renamingDeviceId === device.deviceId ? (
                      <>
                        <input
                          className="input-text"
                          value={renameValue}
                          onChange={(event) => setRenameValue(event.currentTarget.value)}
                          aria-label="设备名称"
                        />
                        <button type="button" className="button button--primary" disabled={busy} onClick={() => void saveRename(device)}>
                          保存
                        </button>
                        <button type="button" className="button" disabled={busy} onClick={() => setRenamingDeviceId(null)}>
                          取消
                        </button>
                      </>
                    ) : (
                      <button type="button" className="button" disabled={busy} onClick={() => startRename(device)}>
                        重命名
                      </button>
                    )}
                  </div>
                </div>
              </details>
            ))
          )}
        </SettingsCard>
      </section>
    </>
  );
}
