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

## 安装

### 方式一：一键安装（推荐，类似 Claude Code）

需要先安装 [Node.js ≥ 20](https://nodejs.org/) 和 git。

```bash
curl -fsSL https://raw.githubusercontent.com/hegeng1212/Kako-Code/main/scripts/install.sh | bash
```

安装完成后（确保 `~/.local/bin` 在 PATH 中）：

```bash
kako web          # 打开配置界面（Provider / MCP / Skills）
cd ~/your-project
kako              # 在当前目录启动对话
```

### 方式二：macOS 安装包（GitHub Release）

从 [Releases](https://github.com/hegeng1212/Kako-Code/releases) 下载 `kako-x.y.z-macos.pkg`，双击安装。

或使用命令行（将 `0.2.0` 换成实际版本号）：

```bash
VERSION=0.2.0
curl -LO "https://github.com/hegeng1212/Kako-Code/releases/download/v${VERSION}/kako-${VERSION}-macos.pkg"
sudo installer -pkg "kako-${VERSION}-macos.pkg" -target /
```

### 方式三：固定版本的一键脚本

```bash
curl -fsSL https://raw.githubusercontent.com/hegeng1212/Kako-Code/v0.2.0/scripts/install.sh | bash
```

### 方式四：从源码开发

```bash
git clone https://github.com/hegeng1212/Kako-Code.git kako
cd kako
pnpm install
pnpm build
pnpm link:global   # 或 node packages/cli/dist/index.js
```

## 快速开始

```bash
pnpm install
pnpm build

# 1. 打开设置 Web UI（Provider / MCP / Skills）
kako web           # 安装版 / link:global 后
# 或开发模式：
pnpm dev:web       # API :3721 + 开发 UI :5173

# 2. 在 Web UI 中添加火山豆包供应商
#    - 填入 ARK_API_KEY 和接入点 ep-xxx
#    - 点击「设为当前」→「测试」

# 3. 启动对话
cd your-project
kako
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
