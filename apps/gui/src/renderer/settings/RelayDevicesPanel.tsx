import { useState } from "react";

import type { GuiRelayDeviceView, GuiRelayPairSessionView } from "../../shared/ipc.js";

export type RelayDevicesPanelProps = {
  devices: GuiRelayDeviceView[];
  busy: boolean;
  setBusy(value: boolean): void;
  setError(message: string | null): void;
  refresh(): Promise<void>;
};

export function RelayDevicesPanel({ devices, busy, setBusy, setError, refresh }: RelayDevicesPanelProps) {
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
    <section className="settings__section">
      <h3>Relay Devices</h3>
      <div className="settings__row">
        <label className="modal__label" htmlFor="relay-url">Relay URL</label>
        <input
          id="relay-url"
          placeholder="wss://scorel-relay.chanler.dev"
          value={relayUrl}
          onChange={(event) => setRelayUrl(event.currentTarget.value)}
          data-testid="relay-url"
        />
      </div>
      <div className="settings__buttons">
        <button type="button" className="button" disabled={busy} onClick={() => void handlePair()}>
          Pair
        </button>
        <button type="button" className="button" disabled={busy} onClick={() => void handleRefresh()}>
          Refresh
        </button>
      </div>
      {pair ? (
        <div className="settings__pair-code">
          <strong>{pair.pairCode}</strong>
          <span className="modal__hint">Run scorel pair {pair.pairCode}</span>
        </div>
      ) : null}
      <div className="settings__device-list">
        {devices.length === 0 ? (
          <span className="modal__hint">No Relay Devices</span>
        ) : (
          devices.map((device) => (
            <div key={device.deviceId} className="settings__device">
              <span className="settings__device-label">
                <span className={`project-tree__online${device.online ? "" : " project-tree__online--off"}`} />
                {device.label}
              </span>
              <span className="modal__hint">{device.relayUrl}</span>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
