# Device-level Host And Project Registry Design

**日期**：2026-06-01
**状态**：已确认，可进入实现拆分
**正式决策**：[`ADR-006`](../decisions/006-device-host-project-registry.md)

## 目标

将 Scorel 从“一 daemon 一 cwd”升级为“一 Device 一 Host，多 Project”，为 WebUI 添加项目、未来 GUI 本地/远端项目聚合、SSH proxy 和纯 HTTP API 建立统一基础。

## 当前问题

S0043 已统一单一 `scorel` 入口、WS daemon 和本地自动发现，但 daemon 构造时仍固定一个 `workDir`：

```text
scorel daemon serve --cwd /repo
  -> EmbeddedDaemon(workDir=/repo)
  -> createRuntime(cwd=/repo)
```

这意味着 `list_projects` 只是历史 Session JSONL 的聚合视图，不是真正的 Project Registry。UI 无法添加一个尚无 Session 的 workspace，也无法在同一 Device 下可靠切换多个 cwd。

## 目标模型

```text
Device
└── Scorel Host
    ├── ProjectRegistry
    ├── SessionStore
    ├── RuntimePool
    ├── EventHub
    └── TransportAdapters
```

Project 是正式资产：

```typescript
type HostProject = {
  projectId: ProjectId;
  displayName: string;
  workDir: string;
  createdAt: number;
  updatedAt: number;
};
```

Session 必须持有 `projectId`。Host 创建 Runtime 时按 Session 的 `projectId` 读取 canonical `workDir`，再加载该 Project 的 config 和 coding tools。

## 产品入口

### CLI embedded

`scorel chat --cwd .` 创建临时 Host，注册当前 cwd，并在该 Project 下创建 Session。cwd 是 workspace 选择，不是 Host 身份。

### WebUI

WebUI 保持 `Device -> Project -> Session`：

```text
Sidebar Add Project
  -> 选择 Device
  -> 远端目录浏览器
  -> Host.registerProject(path)
```

### GUI

GUI 后续使用 Project-first 聚合：

```text
Add Local Project
  -> 系统文件夹选择器
  -> local Host.registerProject(path)

Add Remote Project
  -> 选择 SSH Device
  -> scorel proxy
  -> 远端目录浏览器
  -> remote Host.registerProject(path)
```

### HTTP API

未来 HTTP handler 必须复用 Host application service：

```text
POST /projects
POST /projects/:projectId/sessions
POST /sessions/:sessionId/messages
GET  /sessions/:sessionId/events
```

## 交付拆分

### S0048

实现 Device-level Host、持久 Project Registry、`projectId` 协议、project-aware Runtime factory，并删除 `projectSlug` 兼容面。

### S0049

实现 WebUI Sidebar Add Project、Device 选择、目录浏览 modal、Project 注册和真实双 workspace smoke。

## 后续但不在本轮

- GUI shell 和系统文件夹选择器。
- SSH Device 配置、安装、bootstrap 和 `scorel proxy`。
- Direct WS 高级连接入口整理。
- HTTP + SSE API adapter。
- Project worker 子进程、sandbox 和多用户权限。
