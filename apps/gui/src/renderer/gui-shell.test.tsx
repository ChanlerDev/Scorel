// @vitest-environment jsdom

import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { GuiModelProfileView, GuiProjectView } from "../shared/ipc.js";
import { modelSelectionFromValue, selectedModelValue } from "./App.js";
import { ProjectPickerMenu } from "./composer/ProjectPickerMenu.js";
import { MemorySection } from "./settings/sections/MemorySection.js";
import { ObservabilitySection } from "./settings/sections/ObservabilitySection.js";
import { RuntimeSection } from "./settings/sections/RuntimeSection.js";
import { ImSection } from "./settings/sections/ImSection.js";
import { ProviderSection } from "./settings/sections/ProviderSection.js";
import { ConfigSection } from "./settings/sections/ConfigSection.js";
import { SettingsShell } from "./settings/SettingsShell.js";
import { Sidebar } from "./shell/Sidebar.js";
import { EmptyState } from "./workspace/EmptyState.js";
import { Topbar } from "./workspace/Topbar.js";
import { Workspace } from "./workspace/Workspace.js";

const noop = (): void => {};
let root: Root | undefined;
let container: HTMLDivElement | undefined;

const setInputValue = (input: HTMLInputElement, value: string): void => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
};

afterEach(() => {
  if (root) {
    act(() => {
      root?.unmount();
    });
  }
  root = undefined;
  container?.remove();
  container = undefined;
  vi.restoreAllMocks();
});

const modelProfile: GuiModelProfileView = {
  providers: [
    {
      providerId: "test",
      type: "custom",
      provider: "scorel-test/main-model",
      api: "openai-completions",
      baseUrl: "https://llm.example.test/v1",
      apiKeyEnv: "SCOREL_API_KEY",
      credentialSource: "env",
      credentialStatus: "available",
    },
  ],
  providerModels: [
    {
      providerModelId: "test_main",
      providerId: "test",
      provider: "scorel-test/main-model",
      id: "main-model",
      displayName: "Main Model",
      availableModelIds: ["main"],
      contextWindow: 128000,
      maxTokens: 32000,
      reasoning: false,
    },
  ],
  models: [
    {
      modelId: "main",
      providerModelId: "test_main",
      providerId: "test",
      provider: "scorel-test/main-model",
      id: "main-model",
      displayName: "Main Model",
      roles: ["primary", "standard"],
    },
  ],
  roles: {
    primary: "main",
    standard: "main",
    auxiliary: "main",
  },
};

const memorySettings = {
  enabled: true,
  daily: true,
  sessionMemory: true,
  autoDream: true,
  promoteRoot: true,
  dreamIdleMinutes: 60,
  autoCompactThreshold: 0.8,
};

const memoryStatus = {
  projectId: "project_scorel" as never,
  dirty: true,
  running: false,
  lastDailyAppendAt: Date.UTC(2026, 5, 12, 8, 30),
  scheduledFor: Date.UTC(2026, 5, 12, 9, 30),
  lastProjectMemoryUpdateAt: Date.UTC(2026, 5, 12, 7, 30),
};

const runtimeSettings = {
  tokenSavingRtk: true,
  rtkAvailable: true,
  rtkExecutable: "/usr/local/bin/rtk",
  rtkVersion: "rtk 0.42.4",
  estimatedOutputTokens: 1200,
  estimatedSavedTokens: 4800,
};

const observabilitySettings = {
  local: true,
  sync: { enabled: false, mode: "manual" as const, targets: ["langfuse" as const] },
  langfuse: {
    enabled: true,
    host: "https://cloud.langfuse.com",
    publicKey: "pk-lf-test",
    secretKey: "sk-lf-test",
  },
  otel: {
    enabled: false,
    endpoint: "http://localhost:4318",
    protocol: "otlp-http" as const,
  },
};

const telegramSettings = {
  extensionId: "telegram",
  enabled: false,
  kind: "im" as const,
  config: {},
  active: false,
};

const imExtensions = {
  telegram: telegramSettings,
  qq: {
    extensionId: "qq",
    enabled: false,
    kind: "im" as const,
    config: {},
    active: false,
  },
  wechat: {
    extensionId: "wechat",
    enabled: false,
    kind: "im" as const,
    config: {},
    active: false,
  },
};

const modelProps = {
  models: modelProfile.models,
  selectedModelId: "main",
  onModelChange: noop,
};

const localProject: GuiProjectView = {
  source: "local",
  projectId: "project_scorel" as never,
  displayName: "Scorel",
  workDir: "/Users/chanler/Scorel",
  createdAt: 0,
  updatedAt: 0,
};

const remoteProject: GuiProjectView = {
  source: "relay",
  deviceId: "device_remote",
  projectId: "project_remote" as never,
  displayName: "Remote Repo",
  workDir: "/srv/remote-repo",
  relayUrl: "wss://scorel-relay.chanler.dev",
};

describe("GUI shell rendering contract", () => {
  it("does not render disabled placeholder actions in the sidebar", () => {
    const html = renderToStaticMarkup(
      <Sidebar
        projects={[localProject]}
        selectedProjectKey="local:project_scorel"
        selectedSessionId={null}
        relayDevices={[]}
        sessionsByProject={{}}
        busy={false}
        onNewSessionClick={noop}
        onProjectPickerOpen={noop}
        onProjectClick={noop}
        onProjectExpanded={noop}
        onSessionClick={noop}
        onSettingsClick={noop}
      />,
    );

    expect(html).toContain("新对话");
    expect(html).toContain("设置");
    expect(html).toContain('data-testid="sidebar-add-project"');
    expect(html).not.toContain("搜索");
    expect(html).not.toContain("插件");
    expect(html).not.toContain("自动化");
  });

  it("keeps new chat as an empty composer action even without a selected project", () => {
    const html = renderToStaticMarkup(
      <Sidebar
        projects={[]}
        selectedProjectKey={null}
        selectedSessionId={null}
        relayDevices={[]}
        sessionsByProject={{}}
        busy={false}
        onNewSessionClick={noop}
        onProjectPickerOpen={noop}
        onProjectClick={noop}
        onProjectExpanded={noop}
        onSessionClick={noop}
        onSettingsClick={noop}
      />,
    );

    expect(html).toContain('data-testid="sidebar-new-session"');
    expect(html).not.toMatch(/disabled=""[^>]*data-testid="sidebar-new-session"|data-testid="sidebar-new-session"[^>]*disabled=""/);
  });

  it("renders sidebar resize and collapse affordances", () => {
    const html = renderToStaticMarkup(
      <Sidebar
        projects={[localProject]}
        selectedProjectKey="local:project_scorel"
        selectedSessionId={"session_long"}
        relayDevices={[]}
        sessionsByProject={{
          "local:project_scorel": [
            {
              sessionId: "session_long" as never,
              projectId: localProject.projectId,
              title: "这是一个非常非常长的会话标题，应该在侧边栏内截断而不是撑出横向滚动条",
              updatedAt: 1,
              currentSeq: 1 as never,
            },
          ],
        }}
        busy={false}
        onNewSessionClick={noop}
        onProjectPickerOpen={noop}
        onProjectClick={noop}
        onProjectExpanded={noop}
        onSessionClick={noop}
        onSettingsClick={noop}
        onSidebarToggle={noop}
      />,
    );

    expect(html).toContain('data-testid="sidebar-toggle"');
    expect(html).toContain('data-testid="sidebar-resize-handle"');
    expect(html).toContain('title="这是一个非常非常长的会话标题，应该在侧边栏内截断而不是撑出横向滚动条"');
  });

  it("renders a topbar sidebar toggle for the collapsed state", () => {
    const html = renderToStaticMarkup(
      <Topbar
        title="用户问候你好"
        sidebarCollapsed={true}
        onSidebarToggle={noop}
      />,
    );

    expect(html).toContain('data-testid="topbar-sidebar-toggle"');
    expect(html).toContain('aria-label="展开侧边栏"');
  });

  it("does not reserve an empty topbar in the empty workspace", () => {
    const html = renderToStaticMarkup(
      <Workspace
        selectedProject={localProject}
        selectedSessionTitle={undefined}
        hasActiveSession={false}
        turns={[]}
        message=""
        onMessageChange={noop}
        onSubmit={noop}
        busy={false}
        inFlight={false}
        {...modelProps}
        error={null}
        hostMessage={undefined}
        onPickerOpen={noop}
      />,
    );

    expect(html).toContain("workspace--no-topbar");
    expect(html).not.toContain('class="topbar"');
  });

  it("shows a stable fallback title for active sessions before title generation", () => {
    const html = renderToStaticMarkup(
      <Workspace
        selectedProject={localProject}
        selectedSessionTitle={undefined}
        hasActiveSession={true}
        turns={[]}
        message=""
        onMessageChange={noop}
        onSubmit={noop}
        busy={false}
        inFlight={false}
        {...modelProps}
        error={null}
        hostMessage={undefined}
        onPickerOpen={noop}
      />,
    );

    expect(html).toContain('class="topbar"');
    expect(html).toContain("未命名对话");
  });

  it("uses distinct empty workspace headings for no project and selected project", () => {
    const noProjectHtml = renderToStaticMarkup(
      <EmptyState
        selectedProject={undefined}
        message=""
        onMessageChange={noop}
        onSubmit={noop}
        onPickerOpen={noop}
        busy={false}
        inFlight={false}
        {...modelProps}
      />,
    );
    const selectedProjectHtml = renderToStaticMarkup(
      <EmptyState
        selectedProject={localProject}
        message=""
        onMessageChange={noop}
        onSubmit={noop}
        onPickerOpen={noop}
        busy={false}
        inFlight={false}
        {...modelProps}
      />,
    );

    expect(noProjectHtml).toContain("我们要构建什么？");
    expect(noProjectHtml).not.toContain("<textarea disabled");
    expect(selectedProjectHtml).toContain("我们应该在");
    expect(selectedProjectHtml).toContain(">Scorel</button>");
    expect(selectedProjectHtml).toContain("中构建什么？");
  });

  it("makes the selected project name clickable from the empty heading", () => {
    const html = renderToStaticMarkup(
      <EmptyState
        selectedProject={localProject}
        message=""
        onMessageChange={noop}
        onSubmit={noop}
        onPickerOpen={noop}
        busy={false}
        inFlight={false}
        {...modelProps}
      />,
    );

    expect(html).toContain('data-testid="empty-heading-project-picker"');
  });

  it("does not render unimplemented composer controls", () => {
    const html = renderToStaticMarkup(
      <EmptyState
        selectedProject={localProject}
        message=""
        onMessageChange={noop}
        onSubmit={noop}
        onPickerOpen={noop}
        busy={false}
        inFlight={false}
        {...modelProps}
      />,
    );

    expect(html).not.toContain("完全访问");
    expect(html).not.toContain("5.5 中");
    expect(html).not.toContain("Voice");
    expect(html).not.toContain("Add attachment");
    expect(html).not.toContain("本地模式");
    expect(html).toContain("Main Model");
    expect(html).toContain('data-testid="composer-model-picker"');
  });

  it("keeps the project picker project-first without a null project option", () => {
    const html = renderToStaticMarkup(
      <ProjectPickerMenu
        projects={[localProject]}
        selectedKey="local:project_scorel"
        onSelect={vi.fn()}
        onAddLocal={vi.fn()}
        onAddRemote={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(html).toContain("添加本地项目");
    expect(html).toContain("添加远程项目");
    expect(html).not.toContain("不使用项目");
  });

  it("does not expose unimplemented settings sections or fake config controls", () => {
    const html = renderToStaticMarkup(
      <SettingsShell
        devices={[]}
        selectedDeviceKey="local"
        onDeviceSelect={noop}
        device={{ source: "local" }}
        modelProfile={modelProfile}
        memory={memorySettings}
        memoryStatus={memoryStatus}
        runtime={runtimeSettings}
        observability={observabilitySettings}
        imExtensions={imExtensions}
        onModelProfileChange={noop}
        onMemoryChange={noop}
        onRuntimeChange={noop}
        onObservabilityChange={noop}
        onExtensionChange={noop}
        busy={false}
        setBusy={noop}
        setError={noop}
        refresh={async () => undefined}
        onBack={noop}
      />,
    );

    expect(html).toContain("模型");
    expect(html).toContain("Provider");
    expect(html).toContain("记忆");
    expect(html).toContain("Token 节省");
    expect(html).toContain("可观测性");
    expect(html).toContain("Main Model");
    expect(html).toContain("工作模型");
    expect(html).toContain("已选用模型");
    expect(html).toContain("scorel-test / main-model");
    expect(html).not.toContain("scorel-test/main-model/main-model");
    expect(html).toContain(">Main Model</option>");
    expect(html.indexOf("工作模型")).toBeLessThan(html.indexOf("已选用模型"));
    expect(html).not.toContain("加入可用模型");
    expect(html).toContain("保存工作模型");
    expect(html).not.toContain("Available model id");
    expect(html).not.toContain("Provider Management");
    expect(html).not.toContain("Provider type");
    expect(html).not.toContain("API key env");
    expect(html).not.toContain("Base URL");
    expect(html).not.toContain("Relay 设备");
    expect(html).not.toContain("MCP 服务器");
    expect(html).not.toContain("浏览器");
    expect(html).not.toContain("电脑操控");
    expect(html).not.toContain("钩子");
    expect(html).not.toContain("批准策略");
    expect(html).not.toContain("沙盒设置");
    expect(html).not.toContain("打开 config.toml");
  });

  it("keeps model and connection settings as separate pages", () => {
    const html = renderToStaticMarkup(
      <SettingsShell
        devices={[]}
        selectedDeviceKey="local"
        onDeviceSelect={noop}
        device={{ source: "local" }}
        modelProfile={modelProfile}
        memory={memorySettings}
        memoryStatus={memoryStatus}
        runtime={runtimeSettings}
        observability={observabilitySettings}
        imExtensions={imExtensions}
        onModelProfileChange={noop}
        onMemoryChange={noop}
        onRuntimeChange={noop}
        onObservabilityChange={noop}
        onExtensionChange={noop}
        busy={false}
        setBusy={noop}
        setError={noop}
        refresh={async () => undefined}
        onBack={noop}
      />,
    );

    expect(html).toContain("模型");
    expect(html).toContain("Provider");
    expect(html).toContain("记忆");
    expect(html).toContain("Token 节省");
    expect(html).toContain("可观测性");
    expect(html).toContain("连接");
    expect(html).toContain("已选用模型");
    expect(html).not.toContain("加入可用模型");
    expect(html).not.toContain("模型来源");
    expect(html).not.toContain("Provider type");
    expect(html).not.toContain("Relay URL");
  });

  it("shows a real settings scope selector for local and remote devices", () => {
    const html = renderToStaticMarkup(
      <SettingsShell
        devices={[{ deviceId: "device_remote", label: "Remote Device", relayUrl: "wss://scorel-relay.chanler.dev", online: true, updatedAt: 1 }]}
        selectedDeviceKey="relay:device_remote"
        onDeviceSelect={noop}
        device={{ source: "relay", deviceId: "device_remote" }}
        modelProfile={modelProfile}
        memory={memorySettings}
        memoryStatus={memoryStatus}
        runtime={runtimeSettings}
        observability={observabilitySettings}
        imExtensions={imExtensions}
        onModelProfileChange={noop}
        onMemoryChange={noop}
        onRuntimeChange={noop}
        onObservabilityChange={noop}
        onExtensionChange={noop}
        busy={false}
        setBusy={noop}
        setError={noop}
        refresh={async () => undefined}
        onBack={noop}
      />,
    );

    expect(html).toContain("settings-nav__scope");
    expect(html).toContain("此电脑");
    expect(html).toContain("Remote Device");
    expect(html).toContain('value="relay:device_remote" selected=""');
    expect(html).not.toContain("此电脑 / Scorel");
    expect(html).not.toContain("Remote Device / Remote Repo");
    expect(html).not.toContain("aria-disabled=\"true\"");
  });

  it("renders connection setup with official Relay default and editable device details", () => {
    const html = renderToStaticMarkup(
      <ConfigSection
        devices={[{ deviceId: "device_remote", label: "Remote Device", relayUrl: "wss://scorel-relay.chanler.dev", online: true, updatedAt: 1 }]}
        busy={false}
        setBusy={noop}
        setError={noop}
        refresh={async () => undefined}
      />,
    );

    expect(html).toContain("官方 Relay");
    expect(html).toContain("Get Pair Code");
    expect(html).toContain("编辑");
    expect(html).not.toContain('data-testid="relay-url"');
    expect(html).toContain("Remote Device");
    expect(html).toContain("Device ID");
    expect(html).toContain("device_remote");
    expect(html).toContain("IP");
    expect(html).toContain("未上报");
    expect(html).toContain("relay-device-row__chevron");
    expect(html).toContain("relay-device-row__edit-button");
    expect(html).toContain("编辑 Remote Device 名称");
    expect(html).not.toContain(">重命名<");
  });

  it("renders LLM provider management on its own settings page", () => {
    const html = renderToStaticMarkup(
      <ProviderSection
        device={{ source: "local" }}
        modelProfile={modelProfile}
        busy={false}
        setBusy={noop}
        setError={noop}
        onModelProfileChange={noop}
      />,
    );

    expect(html).toContain("提供商");
    expect(html).toContain("提供商名称");
    expect(html).toContain("API Key");
    expect(html).toContain("直接填写");
    expect(html).toContain("环境变量");
    expect(html).toContain("Base URL");
    expect(html).toContain("模型列表");
    expect(html).toContain("搜索模型");
    expect(html).toContain("获取模型");
    expect(html).toContain("provider-model-card");
    expect(html).toContain("新建提供商");
    expect(html).toContain("手动添加模型");
    expect(html).toContain("选用");
    expect(html).toContain("配置");
    expect(html).toContain("测试模型");
    expect(html).toContain("删除提供商");
    expect(html).toContain("provider-form-actions");
    expect(html).not.toContain("provider-danger-zone");
    expect(html).not.toContain("危险操作");
    expect(html.indexOf("删除提供商")).toBeLessThan(html.indexOf("搜索模型"));
    expect(html).not.toContain("保存提供商");
    expect(html).not.toContain("Context");
    expect(html).not.toContain("Max Tokens");
    expect(html).not.toContain("Reasoning");
    expect(html).not.toContain("Provider id");
    expect(html).not.toContain("Provider model key");
    expect(html).not.toContain("openai-completions");
    expect(html).not.toContain("chanleramp");
    expect(html).not.toContain("deepseek-v4-flash");
    expect(html).not.toContain("Relay URL");
  });

  it("keeps provider model configuration open across autosave profile refreshes", async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const updatedProfile = {
      ...modelProfile,
      providerModels: modelProfile.providerModels.map((model) => ({
        ...model,
        displayName: "Main Model Updated",
      })),
    };
    const upsertModelProfile = vi.fn(async () => updatedProfile);
    Object.defineProperty(window, "scorel", {
      configurable: true,
      value: {
        upsertModelProfile,
      },
    });

    function Harness() {
      const [profile, setProfile] = useState<GuiModelProfileView>(modelProfile);
      return (
        <ProviderSection
          device={{ source: "local" }}
          modelProfile={profile}
          busy={false}
          setBusy={noop}
          setError={noop}
          onModelProfileChange={setProfile}
        />
      );
    }

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root!.render(<Harness />);
    });
    await act(async () => {
      (container!.querySelector('[aria-label="配置"]') as HTMLButtonElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const dialog = () => container!.querySelector('[role="dialog"][aria-label="Model configuration"]') as HTMLElement | null;
    expect(dialog()).not.toBeNull();

    await act(async () => {
      const input = dialog()!.querySelector("input") as HTMLInputElement;
      input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
      await Promise.resolve();
    });

    expect(upsertModelProfile).toHaveBeenCalledTimes(1);
    expect(dialog()).not.toBeNull();
    expect((dialog()!.querySelector("input") as HTMLInputElement).value).toBe("Main Model Updated");

    await act(async () => {
      dialog()!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    expect(dialog()).not.toBeNull();

    await act(async () => {
      (dialog()!.querySelector('[aria-label="Close"]') as HTMLButtonElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(dialog()).toBeNull();
  });

  it("lets provider credentials switch to direct mode before saving the entered key", async () => {
    const upsertModelProfile = vi.fn(async () => ({
      ...modelProfile,
      providers: modelProfile.providers.map((provider) => ({
        ...provider,
        apiKeyEnv: undefined,
        credentialSource: "direct" as const,
      })),
    }));
    Object.defineProperty(window, "scorel", {
      configurable: true,
      value: {
        upsertModelProfile,
      },
    });

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root!.render(
        <ProviderSection
          device={{ source: "local" }}
          modelProfile={modelProfile}
          busy={false}
          setBusy={noop}
          setError={noop}
          onModelProfileChange={noop}
        />,
      );
    });

    const credentialMode = Array.from(container.querySelectorAll("select")).find((select) =>
      Array.from(select.options).some((option) => option.value === "direct"),
    ) as HTMLSelectElement;

    await act(async () => {
      credentialMode.value = "direct";
      credentialMode.dispatchEvent(new Event("change", { bubbles: true }));
      await Promise.resolve();
    });

    expect(upsertModelProfile).not.toHaveBeenCalled();
    const apiKeyInput = container.querySelector('input[type="password"]') as HTMLInputElement;
    expect(apiKeyInput).not.toBeNull();

    await act(async () => {
      setInputValue(apiKeyInput, "direct-secret");
      apiKeyInput.dispatchEvent(new Event("input", { bubbles: true }));
      apiKeyInput.dispatchEvent(new Event("change", { bubbles: true }));
      apiKeyInput.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
      await Promise.resolve();
    });

    expect(upsertModelProfile).toHaveBeenCalledWith(
      { source: "local" },
      expect.objectContaining({
        providerId: "test",
        apiKey: "direct-secret",
      }),
    );
    const savedInput = (upsertModelProfile.mock.calls[0] as unknown[] | undefined)?.[1];
    expect(savedInput).not.toHaveProperty("apiKeyEnv");
  });

  it("normalizes composer model selections before creating sessions", () => {
    expect(modelSelectionFromValue("main", modelProfile)).toEqual({ modelId: "main" });
    expect(modelSelectionFromValue("standard", modelProfile)).toBeUndefined();
    expect(modelSelectionFromValue("missing", modelProfile)).toBeUndefined();
    expect(selectedModelValue({
      ...modelProfile,
      roles: { primary: "primary", standard: "standard", auxiliary: "auxiliary" },
    }, "")).toBe("main");
  });

  it("renders real memory settings controls", () => {
    const html = renderToStaticMarkup(
      <MemorySection
        device={{ source: "local" }}
        memory={memorySettings}
        status={memoryStatus}
        busy={false}
        setBusy={noop}
        setError={noop}
        onMemoryChange={noop}
      />,
    );

    expect(html).toContain("启用记忆");
    expect(html).toContain("Memory 状态");
    expect(html).toContain("Scheduled");
    expect(html).toContain("Last daily");
    expect(html).toContain("自动 daily");
    expect(html).toContain("Session Memory");
    expect(html).toContain("Auto Compact");
    expect(html).toContain("自动 dream");
    expect(html).toContain("Dream 延迟");
    expect(html).toContain("提升到全局");
  });

  it("renders RTK token saving settings and Scorel savings status", () => {
    const html = renderToStaticMarkup(
      <RuntimeSection
        device={{ source: "local" }}
        runtime={runtimeSettings}
        busy={false}
        setBusy={noop}
        setError={noop}
        onRuntimeChange={noop}
      />,
    );

    expect(html).toContain("Token 节省");
    expect(html).toContain("RTK");
    expect(html).toContain("已可用");
    expect(html).toContain("Bash 输出 Token");
    expect(html).toContain("已节省 Token");
    expect(html).toContain("Scorel 已记录的 Bash 工具原始输出估算量");
    expect(html).toContain("4,800");
    expect(html).toContain("1,200");
  });

  it("renders observability sync settings for Langfuse and OpenTelemetry", () => {
    const html = renderToStaticMarkup(
      <ObservabilitySection
        device={{ source: "local" }}
        observability={observabilitySettings}
        busy={false}
        setBusy={noop}
        setError={noop}
        onObservabilityChange={noop}
      />,
    );

    expect(html).toContain("可观测性");
    expect(html).toContain("本地观测资产");
    expect(html).toContain("自动同步");
    expect(html).toContain("Langfuse");
    expect(html).toContain("Public Key");
    expect(html).toContain("OpenTelemetry");
    expect(html).toContain("OTLP Endpoint");
  });

  it("renders compact IM platform rows collapsed by default", () => {
    const html = renderToStaticMarkup(
      <ImSection
        extensions={{
          ...imExtensions,
          telegram: { ...telegramSettings, config: { credentialMode: "direct" } },
        }}
        busy={false}
        setBusy={noop}
        setError={noop}
        onExtensionChange={noop}
      />,
    );

    expect(html).toContain("Telegram");
    expect(html).toContain("QQ Bot");
    expect(html).toContain("WeChat");
    expect(html).toContain("im-platform__summary");
    expect(html).not.toContain("im-platform__details");
    expect(html).not.toContain("Telegram Bot 配置");
    expect(html).not.toContain("凭证方式");
    expect(html).not.toContain("Bot API Key");
    expect(html).not.toContain("Allowed Conversations");
  });
});
