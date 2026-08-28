# S0124: Terminal-Bench GPT-5.6 Result

## 目标

在项目 README 的 benchmark 表格中发布由 Scorel v0.0.13 完成的 GPT-5.6 Luna Terminal-Bench 2.1 结果，并链接到对应的 Harbor Job。

## 范围

- 记录 benchmark、Scorel 版本、模型、reasoning effort、K、case/trial 数、Mean reward、Pass@2 和 error 数。
- 链接到上传并完成隐私清理的 Harbor Job。
- 为现有 benchmark 表格补充独立的 Reasoning effort 列；未知的历史值不做推测。
- 同步 ROADMAP 中 S0121-S0124 的最终状态和 spec 索引。

## 不做什么

- 不提交 Harbor Job 产物、provider identity、API key、base URL 或其他连接信息。
- 不修改、补跑或重新计算 benchmark trial。
- 不公开当前为 private 的 Harbor Job；可见性由 Job 所有者单独管理。

## 验收标准

- README 记录 Scorel v0.0.13、GPT-5.6 Luna、Max、K=2、89 cases、178 trials、75.28% Mean reward、83.15% Pass@2 和 3 errors。
- README Harbor 链接指向已上传的完整 178-trial Job。
- S0124 是 S0123 之后的唯一连续正式 spec 编号。
- diff 不包含私有 provider、credential 或 endpoint。

## 测试要求

- 根据 Harbor Job 的 `result.json` 核对聚合结果。
- 根据 trial `agent_info.version` 核对 Scorel 版本。
- 检查 Markdown 表格列数一致，并审计 diff 中不存在敏感连接信息。

## 影响文件

- `README.md`
- `docs/ROADMAP.md`
- `docs/spec/ship/S0124-terminal-bench-gpt56-result.md`

## 风险与边界

- Harbor Job 当前为 private，因此公开 README 中的链接在 Job 转为 public 前仅授权用户可见。
- 3 个 error 是该次完整运行的真实结果，保留为 0 reward，不以新版本重跑结果替换。
