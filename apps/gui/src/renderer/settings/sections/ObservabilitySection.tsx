import { useEffect, useState } from "react";

import type { GuiDeviceRef, GuiObservabilitySettingsView, GuiUpsertObservabilitySettingsInput } from "../../../shared/ipc.js";
import { SettingsCard } from "../SettingsCard.js";
import { SettingsHeader } from "../SettingsHeader.js";
import { SettingsRow } from "../SettingsRow.js";
import { Select } from "../controls/Select.js";
import { Toggle } from "../controls/Toggle.js";

export type ObservabilitySectionProps = {
  device: GuiDeviceRef;
  observability: GuiObservabilitySettingsView;
  busy: boolean;
  setBusy(value: boolean): void;
  setError(message: string | null): void;
  onObservabilityChange(observability: GuiObservabilitySettingsView): void;
};

export function ObservabilitySection(props: ObservabilitySectionProps) {
  const update = async (patch: GuiUpsertObservabilitySettingsInput): Promise<void> => {
    props.setBusy(true);
    try {
      const next = await window.scorel.upsertObservabilitySettings(props.device, patch);
      props.onObservabilityChange(next);
      props.setError(null);
    } catch (cause) {
      props.setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      props.setBusy(false);
    }
  };

  const disabled = props.busy;
  const targets = new Set(props.observability.sync.targets);

  const updateTarget = (target: "langfuse" | "otel", enabled: boolean): void => {
    const nextTargets = new Set(props.observability.sync.targets);
    if (enabled) {
      nextTargets.add(target);
    } else {
      nextTargets.delete(target);
    }
    void update({
      sync: { targets: [...nextTargets] },
      ...(target === "langfuse" ? { langfuse: { enabled } } : { otel: { enabled } }),
    });
  };

  return (
    <>
      <SettingsHeader title="可观测性" subtitle="保留本地观测资产，并按需同步到 Langfuse 或 OpenTelemetry。" />
      <section className="settings-section settings-section--wide">
        <SettingsCard>
          <SettingsRow
            label="本地观测资产"
            description="开启后，Scorel 会为会话保留 trajectory、指标和可回溯同步状态。"
            control={<Toggle checked={props.observability.local} disabled={disabled} onChange={(local) => void update({ local })} ariaLabel="本地观测资产" />}
          />
          <SettingsRow
            label="自动同步"
            description="开启后，后续会话数据会自动同步；关闭时仍可用 observe 命令手动同步。"
            control={<Toggle checked={props.observability.sync.enabled} disabled={disabled} onChange={(enabled) => void update({ sync: { enabled, mode: enabled ? "auto" : "manual" } })} ariaLabel="自动同步可观测性" />}
          />
          <SettingsRow
            label="同步模式"
            description="Manual 只保留本地资产；Auto 会把后续数据覆盖同步到已启用目标。"
            control={(
              <Select
                value={props.observability.sync.mode}
                disabled={disabled}
                ariaLabel="可观测性同步模式"
                options={[
                  { value: "manual", label: "Manual" },
                  { value: "auto", label: "Auto" },
                ]}
                onChange={(mode) => void update({ sync: { mode: mode === "auto" ? "auto" : "manual", enabled: mode === "auto" } })}
              />
            )}
          />
        </SettingsCard>
      </section>
      <section className="settings-section settings-section--wide">
        <SettingsCard>
          <SettingsRow
            label="Langfuse"
            description={targets.has("langfuse") ? "Trajectory 会覆盖同步到 Langfuse。" : "启用后加入同步目标。"}
            control={<Toggle checked={props.observability.langfuse.enabled} disabled={disabled} onChange={(enabled) => updateTarget("langfuse", enabled)} ariaLabel="启用 Langfuse" />}
          />
          <TextField
            label="Langfuse Host"
            description="留空使用 Langfuse SDK 默认地址；私有部署填写完整 URL。"
            value={props.observability.langfuse.host ?? ""}
            placeholder="https://cloud.langfuse.com"
            disabled={disabled}
            onCommit={(host) => void update({ langfuse: { host } })}
          />
          <TextField
            label="Public Key"
            description="保存 Langfuse public key 到本机 Scorel 配置。"
            value={props.observability.langfuse.publicKey ?? ""}
            placeholder="pk-lf-..."
            disabled={disabled}
            onCommit={(publicKey) => void update({ langfuse: { publicKey } })}
          />
          <TextField
            label="Secret Key"
            description="保存 Langfuse secret key 到本机 Scorel 配置；不会写入观测 payload。"
            value={props.observability.langfuse.secretKey ?? ""}
            placeholder="sk-lf-..."
            disabled={disabled}
            password
            onCommit={(secretKey) => void update({ langfuse: { secretKey } })}
          />
        </SettingsCard>
      </section>
      <section className="settings-section settings-section--wide">
        <SettingsCard>
          <SettingsRow
            label="OpenTelemetry"
            description={targets.has("otel") ? "指标会按资产 ID 覆盖导出，避免重复累计。" : "启用后加入同步目标。"}
            control={<Toggle checked={props.observability.otel.enabled} disabled={disabled} onChange={(enabled) => updateTarget("otel", enabled)} ariaLabel="启用 OpenTelemetry" />}
          />
          <TextField
            label="OTLP Endpoint"
            description="OTLP HTTP collector endpoint；当前协议固定为 otlp-http。"
            value={props.observability.otel.endpoint ?? ""}
            placeholder="http://localhost:4318"
            disabled={disabled}
            onCommit={(endpoint) => void update({ otel: { endpoint, protocol: "otlp-http" } })}
          />
          <SettingsRow
            label="OTel Protocol"
            description="Scorel 当前导出为 OTLP HTTP。"
            control={<span className="settings-status-pill">{props.observability.otel.protocol}</span>}
          />
        </SettingsCard>
      </section>
    </>
  );
}

function TextField(props: {
  label: string;
  description: string;
  value: string;
  placeholder?: string;
  disabled?: boolean;
  password?: boolean;
  onCommit(value: string | undefined): void;
}) {
  const [value, setValue] = useState(props.value);

  useEffect(() => {
    setValue(props.value);
  }, [props.value]);

  return (
    <SettingsRow
      label={props.label}
      description={props.description}
      control={(
        <input
          className="input-text"
          type={props.password ? "password" : "text"}
          value={value}
          placeholder={props.placeholder}
          disabled={props.disabled}
          onChange={(event) => setValue(event.currentTarget.value)}
          onBlur={() => props.onCommit(value.trim() || undefined)}
        />
      )}
    />
  );
}
