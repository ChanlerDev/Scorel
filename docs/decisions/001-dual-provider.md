# ADR-001：双体系 Provider + 统一 Agent 接口

**状态**：已确认
**日期**：2026-04-02
**参与者**：Chanler, Claude

## 决策

Scorel 采用**底层两套体系、上层统一 Agent 接口**的架构：

- **API 体系**：Scorel 自管 context、compact、tools、agent loop（对应 e001-e004）
- **CLI 体系**：委派给 CLI 进程，Scorel 做调度层 + 消息双写 + MCP 注入
- **统一 Agent 接口**：对外暴露一致的 `run()` / `get_history()` 接口

## 背景

API 和 CLI 的控制粒度天然不同：
- API 是无状态调用，context 由调用方维护
- CLI 是有状态进程，内部自管 context 和 compact

强行统一 Provider 抽象会导致：对 API 过度封装，对 CLI 失去控制权。

## 影响

- e001-e004 保持不变（API 体系基础）
- 需要新增 Agent 统一层设计（e005）
- CLI adapter 需要独立的接口设计
- CLI-as-tool（agent 调 agent）作为可选能力

## 否决的方案

- ❌ 强行统一 `StreamProvider` 接口覆盖 API + CLI
- ❌ 只做 CLI wrapper 放弃 API 自管（丢失控制权）
