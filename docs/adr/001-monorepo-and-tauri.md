# ADR-001: Monorepo + Tauri 技术选型

## 状态

已接受

## 背景

Kako 需要同时支持 CLI 和桌面应用两种客户端，共享 Harness 核心逻辑。需要选择项目结构、包管理和桌面框架。

## 决策

### Monorepo 结构

采用 pnpm workspace + turborepo：

```
packages/shared/   # 类型定义
packages/core/     # Harness 核心
packages/cli/      # CLI
apps/desktop/      # Tauri App
```

### 桌面框架

采用 Tauri 2（Rust 壳 + WebView），UI 使用 React + Tailwind。

### 构建工具

- 库包：tsup
- 测试：vitest
- 类型：TypeScript strict mode

## 理由

| 选项 | 优点 | 缺点 | 决定 |
|------|------|------|------|
| pnpm workspace | 快速、节省磁盘、严格依赖 | 生态略小于 npm | ✅ 选用 |
| turborepo | 增量构建、任务编排 | 额外配置 | ✅ 选用 |
| Tauri 2 | 轻量、安全、Rust 性能 | 需 Rust 工具链 | ✅ 选用 |
| Electron | 生态成熟 | 体积大、内存占用高 | ❌ |
| 单包结构 | 简单 | CLI/App 逻辑分叉 | ❌ |

### 为什么 Tauri 而非 Electron

- 安装包体积小（~10MB vs ~150MB）
- 内存占用低
- Rust 后端适合本地文件操作和 IPC
- Tauri 2 改进了 mobile 支持和 API 稳定性

### 为什么 pnpm workspace

- `@kako/shared` 类型可被 core/cli/desktop 共享
- workspace protocol 确保版本一致
- turborepo 缓存加速 CI

## 后果

- 开发者需安装 Rust 工具链（仅桌面开发）
- 首版聚焦 macOS，后续扩展 Windows/Linux
- 所有包使用 ESM + TypeScript

## 参考

- [Tauri 2 文档](https://v2.tauri.app/)
- [pnpm workspace](https://pnpm.io/workspaces)
- [turborepo](https://turbo.build/)
