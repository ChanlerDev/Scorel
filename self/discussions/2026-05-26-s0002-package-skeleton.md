# S0002 Package Skeleton 执行记录

**日期**：2026-05-26
**任务**：按 `docs/spec/ship/S0002-package-skeleton.md` 创建最终 workspace 骨架。

## 范围确认

- 只做 `packages/protocol`、`packages/core`、`packages/daemon`、`packages/client`、`apps/cli`、`apps/daemon` 的最小骨架。
- 每个 workspace 提供 package manifest、tsconfig、source entrypoint、import smoke test。
- 不提前实现协议事件、runtime loop、daemon 行为或 CLI chat。

## 实现取舍

- 公共导出只使用 package marker，避免在 S0002 阶段锁定 S0003 之后才应定义的协议/API。
- 依赖边界通过 package manifest inspection 的 smoke test 约束：protocol 无内部依赖，core 只依赖 protocol，daemon 只依赖 protocol/core，client 只依赖 protocol。
- Apps 仅作为 entrypoint shell，CLI 依赖 client/daemon，standalone daemon app 只依赖 daemon。

## 验证

- `pnpm -r typecheck` 通过。
- `pnpm -r test` 通过。
- `pnpm check` 通过。
