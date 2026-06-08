import { ChevronLeft } from "../icons/index.js";
import type { GuiRelayDeviceView } from "../../shared/ipc.js";
import { RelayDevicesPanel } from "./RelayDevicesPanel.js";

export type SettingsPageProps = {
  devices: GuiRelayDeviceView[];
  busy: boolean;
  setBusy(value: boolean): void;
  setError(message: string | null): void;
  refresh(): Promise<void>;
  onBack(): void;
};

export function SettingsPage({
  devices,
  busy,
  setBusy,
  setError,
  refresh,
  onBack,
}: SettingsPageProps) {
  return (
    <div className="settings">
      <div className="settings__header">
        <button type="button" className="settings__back" onClick={onBack}>
          <ChevronLeft size={16} />
          返回
        </button>
        <h2 className="settings__title">设置</h2>
      </div>
      <div className="settings__body">
        <RelayDevicesPanel
          devices={devices}
          busy={busy}
          setBusy={setBusy}
          setError={setError}
          refresh={refresh}
        />
      </div>
    </div>
  );
}
