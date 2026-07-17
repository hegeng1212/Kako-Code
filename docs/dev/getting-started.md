# 开发指南

## 研发规范（给贡献者 / 编码助手）

- 根入口：[AGENTS.md](../../AGENTS.md)（`CLAUDE.md` 指向同一文件）
- 工程红线：[engineering-principles.md](./engineering-principles.md)
- 流程 skill：仓库 [`.agents/skills/`](../../.agents/skills/)（**不是**产品 `skills/`）
- **Docs-first**：新功能或行为变更须先读文档并更新规范/skill，再实现代码

## 环境要求

- Node.js >= 22（仓库根 `.nvmrc`；`.npmrc` 开启 `engine-strict`）
- pnpm 10.12.1（见根 `packageManager`）
- Rust >= 1.77（Tauri 开发，Phase 2）
- macOS / Linux / Windows

质量命令：`pnpm lint`（oxlint）、`pnpm typecheck`、`pnpm test`。CI 见 `.github/workflows/ci.yml`。
## 快速开始

```bash
# 克隆仓库
git clone <repo-url> kako
cd kako

# 安装依赖
pnpm install

# 构建所有包
pnpm build

# 类型检查
pnpm typecheck

# 运行测试
pnpm test
```

## 项目结构

```
packages/shared/   → 类型定义（无运行时依赖）
packages/core/     → Harness 核心逻辑
packages/cli/      → CLI 入口
apps/desktop/      → Tauri 桌面应用
```

## 常用命令（打包 / 服务 / CLI）

```bash
# 设置页 API + Web（后台启停，日志在 ~/.kako/dev/logs/）
pnpm services:restart   # 停旧进程再起 :3721 + :5173
pnpm services:status
pnpm services:stop
pnpm services            # 同 start；也可用 ./scripts/dev-services.sh fg 前台

# 前台开发（同一套 dev:server + Vite）
pnpm dev:web

# 重建并链接本地 CLI → ~/.local/bin/kako
pnpm link:dev            # = ./scripts/link-dev.sh（先 build shared/core/cli）
pnpm rebuild:cli         # 只 build，不写 ~/.local/bin

# macOS 安装包
pnpm pack                # = pnpm pack:macos → release/macos/kako-*-macos.pkg

# 质量门禁（对齐 CI 硬步骤）
pnpm ci                  # lint + test
```

## 开发工作流

### 修改共享类型

```bash
# 编辑 packages/shared/src/
pnpm --filter @kako/shared build
pnpm typecheck
```

### 开发 CLI

```bash
pnpm --filter @kako/cli build

# 在仓库根目录（推荐）
pnpm kako
pnpm kako --cwd ~/workspace

# 或直接使用本地 bin
./node_modules/.bin/kako --cwd ~/workspace

# 全局安装（任意目录可用 kako 命令，只需执行一次）
pnpm link:global
kako --cwd ~/workspace
```

```bash
pnpm --filter @kako/cli dev
```

### 开发 Core

```bash
pnpm --filter @kako/core dev
pnpm --filter @kako/core test
```

### 开发 Desktop（Phase 2）

```bash
pnpm --filter @kako/desktop dev
```

## 构建

```bash
# 构建所有包
pnpm build

# 构建单个包
pnpm --filter @kako/shared build
pnpm --filter @kako/core build
pnpm --filter @kako/cli build
```

## 测试

```bash
# 全部测试
pnpm test

# 单个包
pnpm --filter @kako/shared test
```

测试框架：vitest。测试文件与源码同目录，命名 `*.test.ts`。

## 代码规范

- TypeScript strict mode
- ESM 模块（`"type": "module"`）
- 包间引用使用 workspace protocol：`"@kako/shared": "workspace:*"`
- 导出类型与实现分离：`@kako/shared` 仅类型，`@kako/core` 含实现
- **工程原则**：禁止打补丁式、禁止枚举式修复，见 [engineering-principles.md](./engineering-principles.md)

## 配置

### 用户配置目录

默认 `~/.kako/`，可通过环境变量覆盖：

```bash
export KAKO_HOME=/custom/path
```

### LLM API Key

```bash
export ANTHROPIC_API_KEY=sk-...
export OPENAI_API_KEY=sk-...
```

或写入 `~/.kako/config/providers.yaml`。

## 添加新模块

1. 在 `packages/core/src/` 下创建模块目录
2. 在 `packages/shared/src/` 添加相关类型
3. 从 `packages/core/src/index.ts` 导出
4. 添加 vitest 测试
5. 更新对应 PRD 文档

## 添加新 Tool

1. 在 `packages/shared/src/tool.ts` 确认类型
2. 在 `packages/core/src/tools/builtin/` 实现 handler
3. 在 Tool Registry 注册
4. 更新 `docs/requirements/04-tools.md`
5. 添加测试

## 添加新 Agent

1. 在 `agents/` 创建 YAML 定义
2. 在 `agents/prompts/` 编写 system prompt
3. 更新 `docs/requirements/03-agent.md`
4. Agent loader 自动发现

## 文档

- 需求文档：`docs/requirements/`
- 架构文档：`docs/architecture/`
- ADR：`docs/adr/`
- 工程原则：`docs/dev/engineering-principles.md`
- 修改功能时同步更新对应 PRD

## 常见问题

### pnpm install 失败

确保 Node.js >= 22 且 pnpm 10.12.1（可用 `nvm use` / `fnm use` 读取 `.nvmrc`）：

```bash
corepack enable
corepack prepare pnpm@10.12.1 --activate
```

### 类型找不到

先构建 shared 包：

```bash
pnpm --filter @kako/shared build
```

### turbo 缓存问题

```bash
pnpm build --force
```
