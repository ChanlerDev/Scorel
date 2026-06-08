import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { GuiProjectView } from "../shared/ipc.js";
import { ProjectPickerMenu } from "./composer/ProjectPickerMenu.js";
import { SettingsShell } from "./settings/SettingsShell.js";
import { Sidebar } from "./shell/Sidebar.js";
import { EmptyState } from "./workspace/EmptyState.js";

const noop = (): void => {};

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
      />,
    );

    expect(noProjectHtml).toContain("我们要构建什么？");
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
      />,
    );

    expect(html).not.toContain("完全访问");
    expect(html).not.toContain("5.5 中");
    expect(html).not.toContain("Voice");
    expect(html).not.toContain("Add attachment");
    expect(html).not.toContain("本地模式");
    expect(html).not.toContain("main");
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
        busy={false}
        setBusy={noop}
        setError={noop}
        refresh={async () => undefined}
        onBack={noop}
      />,
    );

    expect(html).toContain("配置");
    expect(html).toContain("Relay 设备");
    expect(html).not.toContain("MCP 服务器");
    expect(html).not.toContain("浏览器");
    expect(html).not.toContain("电脑操控");
    expect(html).not.toContain("钩子");
    expect(html).not.toContain("批准策略");
    expect(html).not.toContain("沙盒设置");
    expect(html).not.toContain("打开 config.toml");
  });
});
