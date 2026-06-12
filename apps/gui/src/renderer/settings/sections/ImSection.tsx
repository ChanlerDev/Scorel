import { useEffect, useState, type Dispatch, type SetStateAction } from "react";

import type { GuiExtensionSettingsView } from "../../../shared/ipc.js";
import { SettingsCard } from "../SettingsCard.js";
import { SettingsHeader } from "../SettingsHeader.js";
import { SettingsRow } from "../SettingsRow.js";
import { Select } from "../controls/Select.js";
import { Toggle } from "../controls/Toggle.js";

type PlatformId = "telegram" | "qq" | "wechat";

type PlatformDefinition = {
  id: PlatformId;
  label: string;
  summary: string;
  detailTitle: string;
  defaultConfig: Record<string, string | number | boolean>;
};

const PLATFORMS: PlatformDefinition[] = [
  {
    id: "telegram",
    label: "Telegram",
    summary: "Bot API long polling",
    detailTitle: "Telegram Bot 配置",
    defaultConfig: {
      credentialMode: "env",
      botTokenEnv: "SCOREL_TELEGRAM_BOT_TOKEN",
      pollIntervalMs: 1000,
    },
  },
  {
    id: "qq",
    label: "QQ Bot",
    summary: "App ID + App Secret 自动换取 Access Token",
    detailTitle: "QQ Bot 配置",
    defaultConfig: {},
  },
  {
    id: "wechat",
    label: "WeChat",
    summary: "粘贴企业微信群机器人 Webhook URL",
    detailTitle: "WeChat 配置",
    defaultConfig: {},
  },
];
const OPEN_PLATFORM_STORAGE_KEY = "scorel.settings.im.openPlatform";
const PLATFORM_IDS = new Set<PlatformId>(PLATFORMS.map((platform) => platform.id));

export type ImSectionProps = {
  extensions: Record<string, GuiExtensionSettingsView>;
  busy: boolean;
  setBusy(value: boolean): void;
  setError(message: string | null): void;
  onExtensionChange(extension: GuiExtensionSettingsView): void;
};

export function ImSection(props: ImSectionProps) {
  const [openPlatform, setOpenPlatform] = useState<PlatformId | null>(() => readStoredOpenPlatform());

  const toggleOpenPlatform = (platformId: PlatformId): void => {
    setOpenPlatform((current) => {
      const next = current === platformId ? null : platformId;
      writeStoredOpenPlatform(next);
      return next;
    });
  };

  return (
    <>
      <SettingsHeader title="IM" subtitle="管理本机 Host 可接入的即时消息入口。" />
      <section className="settings-section settings-section--wide">
        <SettingsCard>
          <div className="im-platform-list">
            {PLATFORMS.map((platform) => (
              <ImPlatform
                key={platform.id}
                platform={platform}
                extension={props.extensions[platform.id] ?? defaultExtension(platform.id)}
                open={openPlatform === platform.id}
                busy={props.busy}
                setBusy={props.setBusy}
                setError={props.setError}
                onToggleOpen={() => toggleOpenPlatform(platform.id)}
                onExtensionChange={props.onExtensionChange}
              />
            ))}
          </div>
        </SettingsCard>
      </section>
    </>
  );
}

function ImPlatform(props: {
  platform: PlatformDefinition;
  extension: GuiExtensionSettingsView;
  open: boolean;
  busy: boolean;
  setBusy(value: boolean): void;
  setError(message: string | null): void;
  onToggleOpen(): void;
  onExtensionChange(extension: GuiExtensionSettingsView): void;
}) {
  const { platform, extension } = props;
  const [config, setConfig] = useState<Record<string, string | number | boolean>>({ ...platform.defaultConfig, ...extension.config });
  const credentialMode = configCredentialMode(extension, config);

  useEffect(() => {
    setConfig({ ...platform.defaultConfig, ...extension.config });
  }, [extension, platform.defaultConfig]);

  const update = async (input: { enabled?: boolean; config?: Record<string, string | number | boolean | undefined> }): Promise<void> => {
    props.setBusy(true);
    try {
      const next = await window.scorel.upsertExtensionSettings({
        extensionId: platform.id,
        kind: "im",
        ...input,
      });
      props.onExtensionChange(next);
      props.setError(null);
    } catch (cause) {
      props.setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      props.setBusy(false);
    }
  };

  const saveConfig = (patch: Record<string, string | number | boolean | undefined>): void => {
    setConfig((current) => ({ ...current, ...definedPatch(patch) }));
    void update({ config: patch });
  };

  return (
    <div className={props.open ? `im-platform im-platform--${platform.id} im-platform--open` : `im-platform im-platform--${platform.id}`}>
      <div className="im-platform__summary">
        <button type="button" className="im-platform__main" onClick={props.onToggleOpen} aria-expanded={props.open}>
          <span className="im-platform__name">{platform.label}</span>
          <span className="im-platform__meta">{extension.active ? "Active" : extension.enabled ? "Configured" : platform.summary}</span>
        </button>
        <Toggle
          checked={extension.enabled}
          disabled={props.busy}
          onChange={(enabled) => void update({ enabled })}
          ariaLabel={`启用 ${platform.label}`}
        />
      </div>
      {props.open ? (
        <div className="im-platform__details">
          <div className="im-platform__detail-head">
            <div>
              <div className="im-platform__detail-title">{platform.detailTitle}</div>
              <div className="im-platform__detail-desc">{platform.summary}</div>
            </div>
            <span className="settings-status-pill">{extension.active ? "Active" : extension.enabled ? "Enabled" : "Disabled"}</span>
          </div>
          <div className="im-platform__fields">
            {platform.id === "telegram" ? (
              <TelegramFields
                config={config}
                credentialMode={credentialMode}
                busy={props.busy}
                setConfig={setConfig}
                saveConfig={saveConfig}
              />
            ) : platform.id === "qq" ? (
              <QQFields config={config} busy={props.busy} setConfig={setConfig} saveConfig={saveConfig} />
            ) : (
              <WeChatFields config={config} busy={props.busy} setConfig={setConfig} saveConfig={saveConfig} />
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function TelegramFields(props: FieldProps & { credentialMode: "env" | "direct" }) {
  return (
    <>
      <SettingsRow
        label="凭证方式"
        description="环境变量更适合长期使用；直接填写会写入用户级 config。"
        control={(
          <Select
            value={props.credentialMode}
            disabled={props.busy}
            ariaLabel="Telegram 凭证方式"
            options={[
              { value: "env", label: "环境变量" },
              { value: "direct", label: "直接填写" },
            ]}
            onChange={(value) => props.saveConfig(value === "direct"
              ? { credentialMode: "direct", botTokenEnv: undefined }
              : { credentialMode: "env", apiKey: undefined, botToken: undefined, botTokenEnv: configString(props.config, "botTokenEnv", "SCOREL_TELEGRAM_BOT_TOKEN") })}
          />
        )}
      />
      {props.credentialMode === "env" ? (
        <TextField field="botTokenEnv" label="Bot Token Env" description="环境变量名；真实 token 从环境变量读取。" fallback="SCOREL_TELEGRAM_BOT_TOKEN" {...props} />
      ) : (
        <TextField field="apiKey" label="Bot API Key" description="直接写入用户级 config；界面隐藏显示，但文件内是明文。" password placeholder="123456:telegram-bot-token" {...props} />
      )}
      <NumberField field="pollIntervalMs" label="Poll Interval" description="Bot API long polling 的本地轮询间隔。" fallback="1000" {...props} />
      <TextField field="allowedChatIds" label="Allowed Chats" description="可选，逗号分隔；留空表示不限制。" placeholder="-1001234567890,123456789" {...props} />
      <TextField field="botUsername" label="Bot Username" description="可选；留空时 adapter 会通过 getMe 获取。" placeholder="scorel_bot" {...props} />
    </>
  );
}

function QQFields(props: FieldProps) {
  return (
    <>
      <TextField field="appId" label="App ID" description="QQ Bot 应用 ID。" {...props} />
      <TextField field="appSecret" label="App Secret" description="直接写入用户级 config；Scorel 会自动换取 Access Token。" password {...props} />
      <TextField field="botId" label="Bot ID" description="可选，用于移除群消息里的 bot mention。" {...props} />
      <TextField field="allowedConversationIds" label="Allowed Conversations" description="可选，逗号分隔；保留给 adapter allow-list。" {...props} />
    </>
  );
}

function WeChatFields(props: FieldProps) {
  return (
    <>
      <TextField field="webhookUrl" label="Outbound Webhook" description="企业微信群机器人只用于出站发送；它不会接收群里用户消息。" password placeholder="https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=..." {...props} />
      <TextField field="callbackToken" label="Callback Token" description="公众号 plaintext 回调用于接收用户消息；需和微信后台 Token 一致。" password {...props} />
      <TextField field="callbackHost" label="Callback Host" description="本机监听地址；公网接入需通过域名或隧道转发到此地址。" fallback="127.0.0.1" {...props} />
      <NumberField field="callbackPort" label="Callback Port" description="0 表示自动选择本地端口；固定公网转发时可填写端口。" fallback="0" {...props} />
    </>
  );
}

type FieldProps = {
  config: Record<string, string | number | boolean>;
  busy: boolean;
  setConfig: Dispatch<SetStateAction<Record<string, string | number | boolean>>>;
  saveConfig(patch: Record<string, string | number | boolean | undefined>): void;
};

function TextField(props: FieldProps & {
  field: string;
  label: string;
  description: string;
  fallback?: string;
  placeholder?: string;
  password?: boolean;
}) {
  const value = configString(props.config, props.field, props.fallback ?? "");
  return (
    <SettingsRow
      label={props.label}
      description={props.description}
      control={(
        <input
          className="input-text"
          type={props.password ? "password" : "text"}
          placeholder={props.placeholder}
          value={value}
          disabled={props.busy}
          onChange={(event) => props.setConfig({ ...props.config, [props.field]: event.currentTarget.value })}
          onBlur={() => props.saveConfig({ [props.field]: value.trim() || undefined })}
        />
      )}
    />
  );
}

function NumberField(props: FieldProps & { field: string; label: string; description: string; fallback: string }) {
  const value = configString(props.config, props.field, props.fallback);
  return (
    <SettingsRow
      label={props.label}
      description={props.description}
      control={(
        <input
          className="input-text"
          inputMode="numeric"
          value={value}
          disabled={props.busy}
          onChange={(event) => props.setConfig({ ...props.config, [props.field]: event.currentTarget.value })}
          onBlur={() => {
            const numeric = Number(value);
            props.saveConfig({ [props.field]: Number.isFinite(numeric) && numeric >= 0 ? numeric : Number(props.fallback) });
          }}
        />
      )}
    />
  );
}

const defaultExtension = (extensionId: PlatformId): GuiExtensionSettingsView => ({
  extensionId,
  enabled: false,
  kind: "im",
  config: {},
  active: false,
});

const definedPatch = (patch: Record<string, string | number | boolean | undefined>): Record<string, string | number | boolean> => {
  const next: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) {
      next[key] = value;
    }
  }
  return next;
};

const configString = (extension: { config?: Record<string, unknown> } | Record<string, unknown>, key: string, fallback: string): string => {
  const source = ("config" in extension && extension.config ? extension.config : extension) as Record<string, unknown>;
  const value = source[key];
  if (value === undefined || value === "") {
    return fallback;
  }
  return String(value);
};

const configCredentialMode = (extension: GuiExtensionSettingsView, config: Record<string, string | number | boolean>): "env" | "direct" => {
  const mode = configString(config, "credentialMode", "");
  if (mode === "direct" || mode === "env") {
    return mode;
  }
  return configString(extension, "apiKey", "") ? "direct" : "env";
};

const readStoredOpenPlatform = (): PlatformId | null => {
  try {
    const value = window.localStorage.getItem(OPEN_PLATFORM_STORAGE_KEY);
    return isPlatformId(value) ? value : null;
  } catch {
    return null;
  }
};

const writeStoredOpenPlatform = (platformId: PlatformId | null): void => {
  try {
    if (platformId) {
      window.localStorage.setItem(OPEN_PLATFORM_STORAGE_KEY, platformId);
    } else {
      window.localStorage.removeItem(OPEN_PLATFORM_STORAGE_KEY);
    }
  } catch {
    // localStorage can be unavailable in restricted browser contexts.
  }
};

const isPlatformId = (value: string | null): value is PlatformId => (
  value === "telegram" || value === "qq" || value === "wechat" || (value !== null && PLATFORM_IDS.has(value as PlatformId))
);
