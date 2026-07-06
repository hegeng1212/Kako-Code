# Kako

**Kako** 是一个 Agent Harness（执行环境）个人助理。LLM 是其中一个组件；Harness 负责持久上下文、工具执行、子 Agent 编排、记忆管理、权限与可观测性。

## 项目结构

```
kako/
├── apps/desktop/       # Tauri 2 桌面应用（Phase 2）
├── packages/
│   ├── core/           # Harness 核心
│   ├── cli/            # CLI 入口
│   └── shared/         # 共享类型与协议
├── docs/               # 需求、架构、开发文档
├── agents/             # 内置 Agent 定义
└── skills/             # 内置/示例 Skills
```

## 快速开始

```bash
pnpm install
pnpm build

# 1. 启动设置 Web UI（自动启动 API + 前端）
pnpm dev:web       # API :3721 + UI :5173

# 2. 在 Web UI 中添加火山豆包供应商
#    - 填入 ARK_API_KEY 和接入点 ep-xxx
#    - 点击「设为当前」→「测试」

# 3. 启动对话
node packages/cli/dist/index.js chat
```

### 火山豆包配置

```bash
export ARK_API_KEY=your-volcengine-api-key
# 或在 Web UI 中直接填写
```

配置存储：`~/.kako/config/providers.json`（参考 `docs/examples/providers.json`）

## 文档

- [产品愿景](docs/requirements/00-vision.md)
- [系统架构](docs/architecture/01-system-architecture.md)
- [开发指南](docs/dev/getting-started.md)
- [路线图](docs/dev/roadmap.md)

## 许可证

待定
