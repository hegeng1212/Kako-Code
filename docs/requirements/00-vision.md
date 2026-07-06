# 产品愿景

## 定位

**Kako** 是一个 **Agent Harness**（执行环境）个人助理，而非单纯的 Chat UI。

LLM 是 Harness 中的一个组件。Harness 本身负责：

- 持久上下文与会话管理
- 工具注册与沙箱执行
- 子 Agent 编排与递归委派
- 多层记忆系统
- 权限控制与 Hook 生命周期
- 可观测性与审计日志

## 目标用户

- 开发者：在项目目录中与 AI 协作编码、调试、规划
- 知识工作者：需要长期记忆与多步骤任务自动化的个人用户
- 高级用户：希望自定义 Agent、Skill、Hook 的 power user

## 核心场景

| 场景 | 描述 |
|------|------|
| 项目内对话 | 在代码仓库中启动 `kako chat`，自动加载 `KAKO.md` 项目上下文 |
| 多步任务委派 | 主 Agent 并行 spawn 探索/规划子 Agent，汇总结果 |
| 长期记忆 | 跨会话记住用户偏好、项目事实、重要事件 |
| Skill 扩展 | 安装 `/commit`、`/review` 等斜杠命令 Skill |
| 可观测性 | 桌面 App 查看工具调用日志、Agent 运行树、Token 成本 |

## 设计原则

1. **本地优先**：数据存储在 `~/.kako/`，用户完全掌控
2. **文件可读**：记忆以 Markdown/JSON 为主，便于 Git 友好与调试
3. **生态兼容**：Skill 遵循 [Agent Skills 开放规范](https://agentskills.io/specification)
4. **逻辑统一**：CLI 与 Desktop App 共享 `@kako/core`，避免分叉
5. **渐进增强**：Phase 1 MVP 聚焦单 Agent REPL，逐步扩展

## 非目标（首版）

- 多用户 / 团队协作 Server（Phase 3 可选扩展）
- 云端同步与托管记忆
- 替代 IDE 的完整代码编辑体验
- 内置 LLM 训练或微调

## 成功指标

- Phase 1：`kako chat` 可完成带 Read/Write/Bash 工具的多轮对话
- Phase 2：子 Agent 并行 + Skill 安装 + Tauri 基础 UI
- Phase 3：MCP 集成 + Workflow DSL + 记忆高级机制
