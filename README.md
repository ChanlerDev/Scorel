# Scorel

Scorel 是一个面向项目型工作的 AI Agent 工作台。

它不是套在 LLM Provider 外面的聊天界面，而是把 Agent 任务抽象为可持续管理的工作资产：任务绑定真实工作区，过程以事件流持久化，运行时由 daemon 统一调度，CLI、WebUI 等入口可以围绕同一个任务观察、接管和恢复。

Scorel 当前优先服务代码开发场景，但架构目标不局限于 coding。任何围绕项目目录、文件资产、工具调用和多轮协作展开的 Agent 任务，都应该能复用同一套 Session、Runtime、Host 和 Client 模型。

## 快速上手指南

安装依赖：

```bash
pnpm install
```

在当前项目目录进入交互式会话：

```bash
pnpm scorel
```

如果要使用 hosted WebUI，启动本机 Host：

```bash
pnpm scorel host serve
```

打开 hosted WebUI：

```text
https://scorel.chanler.dev
```

WebUI 给出 pair code 后，在本机执行：

```bash
pnpm scorel pair <pair-code>
```

第一次运行后，`~/.scorel/daemon.json` 会保存本机 Host 的连接信息。`scorel host serve` 默认连接官方 Relay；自部署时可以传 `--relay <url>`，离线或本地开发时可以传 `--no-relay`。

运行检查：

```bash
pnpm typecheck && pnpm test
```

## 架构

Scorel 采用 thin entry + daemon-owned 的分层架构。CLI、WebUI 只负责输入输出和交互呈现；会话写入、运行时调度、事件广播和恢复逻辑集中在 daemon 层。

```text
apps/cli / apps/webui
        |
        v
@scorel/client
        |
        v
@scorel/daemon
        |
        v
@scorel/core
        |
        v
pi-ai providers
```

主要分层：

| 层 | 职责 |
|---|---|
| `@scorel/protocol` | 定义跨包共享的 ID、wire message、事件和 transport-safe contract。 |
| `@scorel/core` | 承载 Agent runtime loop、工具执行、配置、指令装配和 session 基础能力。 |
| `@scorel/daemon` | 管理 Host、Project registry、Session store、Runtime pool、事件持久化、广播和 resync。 |
| `@scorel/client` | 提供跨入口 SDK，处理 request/response、重连、resync 和 browser-safe transport。 |
| `apps/cli` | 终端入口，提供默认交互、Host lifecycle、pair、attach 和开发态 `scorel up`。 |
| `apps/webui` | 浏览器控制台，展示 Device、Project、Session、Transcript 和运行中交互。 |

## 核心模型

Scorel 使用 Device -> Project -> Session 模型：

- **Device** 表示一台可运行 Agent 的设备。
- **Host** 是 Device 内的逻辑控制平面，拥有 Project、Session 和 Runtime 的权威状态。
- **Project** 把稳定的 `projectId` 绑定到真实工作目录。
- **Session** 保存 append-only JSONL 事件流，并通过 replay 还原上下文。
- **Runtime** 基于历史事件、项目指令、工具能力和 provider 响应执行一轮 Agent 任务。
- CLI 和 WebUI 都是 Host 的 client，不直接成为 Session writer。

这个模型让工作区身份、任务恢复、多端 attach 和远程控制都收敛在 daemon 边界内，避免 UI 入口各自复制状态管理逻辑。

## 当前能力

- 通过 daemon/client 主链路运行本地 Agent 会话。
- 使用 append-only JSONL 持久化 Session，并支持 replay。
- 支持本地和远程 daemon attach、断线重连和事件补偿。
- WebUI 支持 Device、Project、Session、transcript、tool output、prompt、cancel、follow-up 和 steer。
- Project registry 使用稳定 `projectId` 管理真实工作区。
- Runtime 支持 session-scoped instruction snapshot、`AGENTS.md` 装配、system reminder 和 Skill index。

## 文档

正式 source of truth 位于 `docs/`：

- [docs/README.md](docs/README.md) - 文档导航
- [docs/architecture.md](docs/architecture.md) - 系统架构与包边界
- [docs/ROADMAP.md](docs/ROADMAP.md) - 产品阶段路线图
- [docs/SHIP.md](docs/SHIP.md) - 实现、验证和提交协议
- [docs/spec](docs/spec) - 模块合同与编号 ship specs
