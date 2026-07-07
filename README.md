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

支持 **macOS / Linux**（需 bash）。Windows 请使用 [WSL2](https://learn.microsoft.com/windows/wsl/install)。

### 方式一：一键安装（推荐，类似 Claude Code）

**前提：** 已安装 [Node.js ≥ 20](https://nodejs.org/)（建议 LTS）和 [git](https://git-scm.com/)。

在新机器上执行：

```bash
curl -fsSL https://raw.githubusercontent.com/hegeng1212/Kako-Code/main/scripts/install.sh | bash
```

首次安装会从源码构建，约需数分钟。默认安装位置：

| 内容 | 路径 |
|------|------|
| 程序 | `~/.kako/app` |
| 用户配置 / 会话 | `~/.kako/config`、`~/.kako/memory` 等 |
| `kako` 命令 | `~/.local/bin/kako` |

**配置 PATH（首次必做）：** 多数 macOS 默认未包含 `~/.local/bin`。安装脚本若提示添加 PATH，在 zsh 中执行：

```bash
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
```

使用 bash 时改为 `~/.bashrc`。验证：

```bash
which kako
kako --version
```

**开始使用：**

```bash
kako web          # 打开设置界面（Provider / MCP / Skills）
cd ~/your-project
kako              # 在当前目录启动对话
```

固定版本（生产环境更推荐，将 `0.2.0` 换成 [Releases](https://github.com/hegeng1212/Kako-Code/releases) 中的版本号）：

```bash
curl -fsSL https://raw.githubusercontent.com/hegeng1212/Kako-Code/v0.2.0/scripts/install.sh | bash
```

### 方式二：macOS 安装包（GitHub Release）

从 [Releases](https://github.com/hegeng1212/Kako-Code/releases) 下载 `kako-x.y.z-macos.pkg`，双击安装。

或使用命令行（将 `0.2.0` 换成实际版本号）：

```bash
VERSION=0.2.0
curl -LO "https://github.com/hegeng1212/Kako-Code/releases/download/v${VERSION}/kako-${VERSION}-macos.pkg"
sudo installer -pkg "kako-${VERSION}-macos.pkg" -target /
```

### 方式三：从源码开发

```bash
git clone https://github.com/hegeng1212/Kako-Code.git kako
cd kako
pnpm install
pnpm build
pnpm link:global   # 或 node packages/cli/dist/index.js
```

## 卸载

一键卸载脚本会自动检测 **curl 安装** 和 **macOS .pkg 安装**，默认**保留**用户配置（`~/.kako/config`、会话记忆等）。

```bash
curl -fsSL https://raw.githubusercontent.com/hegeng1212/Kako-Code/main/scripts/uninstall.sh | bash
```

非交互确认（例如 CI / 脚本中）：

```bash
KAKO_YES=1 curl -fsSL https://raw.githubusercontent.com/hegeng1212/Kako-Code/main/scripts/uninstall.sh | bash
```

连同用户数据一并删除（Provider 配置、记忆、Skills 等）：

```bash
KAKO_PURGE=1 curl -fsSL https://raw.githubusercontent.com/hegeng1212/Kako-Code/main/scripts/uninstall.sh | bash
```

### curl | bash 安装会删除

| 路径 | 说明 |
|------|------|
| `~/.local/bin/kako` | CLI 启动脚本 |
| `~/.kako/app` | 已部署的程序 |
| `~/.kako/src/Kako-Code` | 安装时 clone 的源码 |
| `~/.kako/.pnpm-store` | 安装用 pnpm 缓存 |
| `~/.kako/.pnpm-home` | 安装用 pnpm 工具 |

### macOS .pkg 安装会删除（需 sudo）

| 路径 | 说明 |
|------|------|
| `/opt/kako` | 程序目录 |
| `/usr/local/bin/kako` | CLI 启动脚本 |

.pkg 与 curl 两种装法可以并存；卸载脚本会一并清理。用户数据目录 `~/.kako` 仅在设置 `KAKO_PURGE=1` 时删除。

### 手动卸载

**curl 安装：**

```bash
rm -f ~/.local/bin/kako
rm -rf ~/.kako/app ~/.kako/src ~/.kako/.pnpm-store ~/.kako/.pnpm-home
# 可选：删除全部用户数据
# rm -rf ~/.kako
```

**macOS .pkg 安装：**

```bash
sudo rm -rf /opt/kako
sudo rm -f /usr/local/bin/kako
sudo pkgutil --forget com.kako.cli.app
# 可选：删除全部用户数据
# rm -rf ~/.kako
```

## 快速开始

### 已安装（`curl | bash` 或 `.pkg`）

```bash
# 1. 确保 PATH 已配置（见上方安装说明）
kako web          # 打开设置 Web UI（Provider / MCP / Skills）

# 2. 在 Web UI 中添加模型供应商（如火山豆包）
#    - 填入 ARK_API_KEY 和接入点 ep-xxx
#    - 点击「设为当前」→「测试」

# 3. 启动对话
cd your-project
kako
```

### 从源码开发

```bash
pnpm install
pnpm build

kako web           # 安装版 / link:global 后
# 或开发模式：
pnpm dev:web       # API :3721 + 开发 UI :5173

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

[MIT](LICENSE)
