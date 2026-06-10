import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { GuiModelProfileView, GuiProjectView } from "../shared/ipc.js";
import { ProjectPickerMenu } from "./composer/ProjectPickerMenu.js";
import { MemorySection } from "./settings/sections/MemorySection.js";
import { ProviderSection } from "./settings/sections/ProviderSection.js";
import { SettingsShell } from "./settings/SettingsShell.js";
import { Sidebar } from "./shell/Sidebar.js";
import { EmptyState } from "./workspace/EmptyState.js";
import { Topbar } from "./workspace/Topbar.js";

const noop = (): void => {};

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
  autoDream: true,
  promoteRoot: true,
  dreamIdleMinutes: 60,
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
        project={{ source: "local", projectId: localProject.projectId }}
        modelProfile={modelProfile}
        memory={memorySettings}
        onModelProfileChange={noop}
        onMemoryChange={noop}
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
        project={{ source: "local", projectId: localProject.projectId }}
        modelProfile={modelProfile}
        memory={memorySettings}
        onModelProfileChange={noop}
        onMemoryChange={noop}
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
    expect(html).toContain("连接");
    expect(html).toContain("已选用模型");
    expect(html).not.toContain("加入可用模型");
    expect(html).not.toContain("模型来源");
    expect(html).not.toContain("Provider type");
    expect(html).not.toContain("Relay URL");
  });

  it("renders LLM provider management on its own settings page", () => {
    const html = renderToStaticMarkup(
      <ProviderSection
        project={{ source: "local", projectId: localProject.projectId }}
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

  it("renders real memory settings controls", () => {
    const html = renderToStaticMarkup(
      <MemorySection
        project={{ source: "local", projectId: localProject.projectId }}
        memory={memorySettings}
        busy={false}
        setBusy={noop}
        setError={noop}
        onMemoryChange={noop}
      />,
    );

    expect(html).toContain("启用记忆");
    expect(html).toContain("自动 daily");
    expect(html).toContain("自动 dream");
    expect(html).toContain("Dream 延迟");
    expect(html).toContain("提升到全局");
  });
});
