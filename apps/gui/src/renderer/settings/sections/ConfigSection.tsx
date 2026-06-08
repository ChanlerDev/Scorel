import { useState } from "react";

import type { GuiRelayDeviceView, GuiRelayPairSessionView } from "../../../shared/ipc.js";
import { SettingsCard } from "../SettingsCard.js";
import { SettingsHeader } from "../SettingsHeader.js";
import { SettingsRow } from "../SettingsRow.js";
import { LinkAccent } from "../controls/LinkAccent.js";
import { Select } from "../controls/Select.js";

export type ConfigSectionProps = {
  devices: GuiRelayDeviceView[];
  busy: boolean;
  setBusy(value: boolean): void;
  setError(message: string | null): void;
  refresh(): Promise<void>;
};

export function ConfigSection({ devices, busy, setBusy, setError, refresh }: ConfigSectionProps) {
  const [relayUrl, setRelayUrl] = useState<string>("");
  const [pair, setPair] = useState<GuiRelayPairSessionView | null>(null);

  const handlePair = async (): Promise<void> => {
    setBusy(true);
    try {
      const result = await window.scorel.createRelayPairSession(relayUrl.trim() || undefined);
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
      await window.scorel.refreshRelayDevices(relayUrl.trim() || pair?.relayUrl || undefined);
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
        title="配置"
        subtitle={
          <>
            配置审批策略和沙盒设置 <LinkAccent href="https://chanler.dev/docs/scorel">了解更多</LinkAccent>
          </>
        }
      />

      <section className="settings-section">
        <h2 className="settings-section__title">自定义 config.toml 设置</h2>
        <SettingsCard
          head={
            <>
              <div className="settings-card__head-meta">
                <Select
                  value="user"
                  options={[{ value: "user", label: "用户配置" }]}
                  disabled
                />
              </div>
              <LinkAccent href="#" trailingArrow>打开 config.toml</LinkAccent>
            </>
          }
        >
          <SettingsRow
            label="批准策略"
            description="选择 Codex 何时请求批准"
            control={
              <Select
                value="never"
                disabled
                options={[
                  { value: "never", label: "从不" },
                  { value: "on_failure", label: "失败时" },
                  { value: "always", label: "始终" },
                ]}
              />
            }
          />
          <SettingsRow
            label="沙盒设置"
            description="选择 Codex 的命令执行权限"
            control={
              <Select
                value="full"
                disabled
                options={[
                  { value: "full", label: "完全访问" },
                  { value: "workspace_write", label: "工作区写入" },
                  { value: "read_only", label: "只读" },
                ]}
              />
            }
          />
        </SettingsCard>
      </section>

      <section className="settings-section">
        <h2 className="settings-section__title">Relay 设备</h2>
        <SettingsCard>
          <SettingsRow
            label="Relay URL"
            description="自定义 relay 端点(留空使用默认)"
            control={
              <>
                <input
                  className="input-text"
                  placeholder="wss://scorel-relay.chanler.dev"
                  value={relayUrl}
                  onChange={(event) => setRelayUrl(event.currentTarget.value)}
                  data-testid="relay-url"
                />
                <button
                  type="button"
                  className="button"
                  disabled={busy}
                  onClick={() => void handlePair()}
                >
                  Pair
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
              <div key={device.deviceId} className="relay-device-row">
                <span className={`project-tree__online${device.online ? "" : " project-tree__online--off"}`} />
                <span style={{ fontWeight: 500 }}>{device.label}</span>
                <span className="relay-device-row__url">{device.relayUrl}</span>
              </div>
            ))
          )}
        </SettingsCard>
      </section>
    </>
  );
}
