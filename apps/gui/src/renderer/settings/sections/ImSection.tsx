import { useEffect, useState } from "react";

import type { GuiExtensionSettingsView } from "../../../shared/ipc.js";
import { SettingsCard } from "../SettingsCard.js";
import { SettingsHeader } from "../SettingsHeader.js";
import { SettingsRow } from "../SettingsRow.js";
import { Select } from "../controls/Select.js";
import { Toggle } from "../controls/Toggle.js";

export type ImSectionProps = {
  telegram: GuiExtensionSettingsView;
  busy: boolean;
  setBusy(value: boolean): void;
  setError(message: string | null): void;
  onTelegramChange(extension: GuiExtensionSettingsView): void;
};

export function ImSection(props: ImSectionProps) {
  const [credentialMode, setCredentialMode] = useState<"env" | "direct">(configCredentialMode(props.telegram));
  const [apiKey, setApiKey] = useState(configString(props.telegram, "apiKey", ""));
  const [botTokenEnv, setBotTokenEnv] = useState(configString(props.telegram, "botTokenEnv", "SCOREL_TELEGRAM_BOT_TOKEN"));
  const [pollIntervalMs, setPollIntervalMs] = useState(configString(props.telegram, "pollIntervalMs", "1000"));
  const [allowedChatIds, setAllowedChatIds] = useState(configString(props.telegram, "allowedChatIds", ""));
  const [botUsername, setBotUsername] = useState(configString(props.telegram, "botUsername", ""));

  useEffect(() => {
    setCredentialMode(configCredentialMode(props.telegram));
    setApiKey(configString(props.telegram, "apiKey", ""));
    setBotTokenEnv(configString(props.telegram, "botTokenEnv", "SCOREL_TELEGRAM_BOT_TOKEN"));
    setPollIntervalMs(configString(props.telegram, "pollIntervalMs", "1000"));
    setAllowedChatIds(configString(props.telegram, "allowedChatIds", ""));
    setBotUsername(configString(props.telegram, "botUsername", ""));
  }, [props.telegram]);

  const update = async (input: { enabled?: boolean; config?: Record<string, string | number | boolean | undefined> }): Promise<void> => {
    props.setBusy(true);
    try {
      const next = await window.scorel.upsertExtensionSettings({
        extensionId: "telegram",
        kind: "im",
        ...input,
      });
      props.onTelegramChange(next);
      props.setError(null);
    } catch (cause) {
      props.setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      props.setBusy(false);
    }
  };

  const savePollInterval = (): void => {
    const value = Number(pollIntervalMs);
    void update({ config: { pollIntervalMs: Number.isFinite(value) && value >= 0 ? value : 1000 } });
  };

  const changeCredentialMode = (mode: "env" | "direct"): void => {
    setCredentialMode(mode);
    void update({
      config: mode === "env"
        ? { credentialMode: "env", apiKey: undefined, botToken: undefined, botTokenEnv: botTokenEnv.trim() || "SCOREL_TELEGRAM_BOT_TOKEN" }
        : { credentialMode: "direct", botTokenEnv: undefined },
    });
  };

  return (
    <>
      <SettingsHeader title="IM" subtitle="管理本机 Host 可接入的即时消息入口。" />
      <section className="settings-section settings-section--wide">
        <SettingsCard>
          <SettingsRow
            label="Telegram"
            description={props.telegram.active ? "已启用并已连接本机 Host。" : "保存后会写入用户级 config，并尝试启动 Telegram adapter。"}
            control={<Toggle checked={props.telegram.enabled} disabled={props.busy} onChange={(enabled) => void update({ enabled })} ariaLabel="启用 Telegram" />}
          />
          <SettingsRow
            label="凭证方式"
            description="环境变量更适合长期使用；直接填写会写入用户级 config。"
            control={(
              <Select
                value={credentialMode}
                disabled={props.busy}
                ariaLabel="Telegram 凭证方式"
                options={[
                  { value: "env", label: "环境变量" },
                  { value: "direct", label: "直接填写" },
                ]}
                onChange={(value) => changeCredentialMode(value === "direct" ? "direct" : "env")}
              />
            )}
          />
          {credentialMode === "env" ? (
            <SettingsRow
              label="Bot Token Env"
              description="环境变量名；真实 token 从环境变量读取。"
              control={(
                <input
                  className="input-text"
                  value={botTokenEnv}
                  disabled={props.busy}
                  onChange={(event) => setBotTokenEnv(event.currentTarget.value)}
                  onBlur={() => void update({ config: { credentialMode: "env", apiKey: undefined, botToken: undefined, botTokenEnv: botTokenEnv.trim() || "SCOREL_TELEGRAM_BOT_TOKEN" } })}
                />
              )}
            />
          ) : (
            <SettingsRow
              label="Bot API Key"
              description="直接写入用户级 config；界面隐藏显示，但文件内是明文。"
              control={(
                <input
                  className="input-text"
                  type="password"
                  placeholder="123456:telegram-bot-token"
                  value={apiKey}
                  disabled={props.busy}
                  onChange={(event) => setApiKey(event.currentTarget.value)}
                  onBlur={() => void update({ config: { credentialMode: "direct", apiKey: apiKey.trim() || undefined, botToken: undefined, botTokenEnv: undefined } })}
                />
              )}
            />
          )}
          <SettingsRow
            label="Poll Interval"
            description="Bot API long polling 的本地轮询间隔。"
            control={(
              <input
                className="input-text"
                inputMode="numeric"
                value={pollIntervalMs}
                disabled={props.busy}
                onChange={(event) => setPollIntervalMs(event.currentTarget.value)}
                onBlur={savePollInterval}
              />
            )}
          />
          <SettingsRow
            label="Allowed Chats"
            description="可选，逗号分隔；留空表示不限制。"
            control={(
              <input
                className="input-text"
                placeholder="-1001234567890,123456789"
                value={allowedChatIds}
                disabled={props.busy}
                onChange={(event) => setAllowedChatIds(event.currentTarget.value)}
                onBlur={() => void update({ config: { allowedChatIds: allowedChatIds.trim() || undefined } })}
              />
            )}
          />
          <SettingsRow
            label="Bot Username"
            description="可选；留空时 adapter 会通过 getMe 获取。"
            control={(
              <input
                className="input-text"
                placeholder="scorel_bot"
                value={botUsername}
                disabled={props.busy}
                onChange={(event) => setBotUsername(event.currentTarget.value)}
                onBlur={() => void update({ config: { botUsername: botUsername.trim() || undefined } })}
              />
            )}
          />
        </SettingsCard>
      </section>
    </>
  );
}

const configString = (extension: GuiExtensionSettingsView, key: string, fallback: string): string => {
  const value = extension.config[key];
  if (value === undefined || value === "") {
    return fallback;
  }
  return String(value);
};

const configCredentialMode = (extension: GuiExtensionSettingsView): "env" | "direct" => {
  const mode = configString(extension, "credentialMode", "");
  if (mode === "direct" || mode === "env") {
    return mode;
  }
  return configString(extension, "apiKey", "") ? "direct" : "env";
};
