# 客户端 PRD

## 概述

Kako 提供两种客户端：CLI（Phase 1）和 Tauri 桌面应用（Phase 2）。两者共享 `@kako/core`，通过进程内调用或 IPC 访问 Harness。

## CLI

### 命令清单

| 命令 | 说明 | Phase |
|------|------|-------|
| `kako chat` | 交互式对话 REPL | 1 |
| `kako agent run <name>` | 运行指定 Agent | 2 |
| `kako skill install <url>` | 安装 Skill | 2 |
| `kako skill list` | 列出 Skill | 2 |
| `kako memory status` | 记忆层状态 | 2 |
| `kako memory consolidate` | 触发记忆整理 | 2 |
| `kako config` | 配置管理 | 1 |
| `kako logs` | 查看调用日志 | 2 |

### `kako chat` 体验

```
$ kako chat
Kako v0.1.0 — Agent: main (anthropic/claude-sonnet-4)
Project: /Users/me/myproject
Context: KAKO.md loaded

> 帮我看看 src/auth 目录的结构

[explore] Searching...
┌─ explore ─────────────────────────────
│ Found 5 files in src/auth/
│ - auth.service.ts (main logic)
│ - auth.controller.ts (routes)
│ ...
└─────────────────────────────────────

根据探索结果，src/auth 包含...
```

- 流式输出 assistant 回复
- 工具调用以折叠块展示
- 支持 `/commit`、`/review` 斜杠命令
- Ctrl+C 优雅退出，触发 SessionEnd hook

### 技术栈

- Commander.js 命令解析
- Clack 交互式 prompt（Phase 2）
- 共享 `@kako/core` 运行时

## Tauri 桌面应用

### 页面规划

| 页面 | 功能 | Phase |
|------|------|-------|
| 对话 | 主聊天界面，流式渲染 | 2 |
| 会话历史 | 浏览历史会话 | 2 |
| 记忆浏览 | L0–L5 记忆层查看与编辑 | 2 |
| Agent 管理 | 查看/编辑 Agent 定义 | 3 |
| Skill 管理 | 安装/卸载 Skill | 3 |
| 工具日志 | 表格：时间、tool、agent、status、duration | 2 |
| 运行树 | Agent 运行树状视图 | 2 |
| 成本仪表盘 | Token 用量与成本 | 3 |
| 设置 | API Key、默认模型、数据目录 | 2 |

### 技术栈

- Tauri 2（Rust 壳 + WebView）
- React + Tailwind CSS
- IPC：Tauri commands 调用 `@kako/core`

### 线框（对话页）

```
┌─────────────────────────────────────────────────┐
│ Kako                              ⚙ Settings   │
├──────────┬──────────────────────────────────────┤
│ Sessions │  Main Agent — claude-sonnet-4       │
│          │                                      │
│ > Today  │  User: 帮我重构 auth 模块            │
│   sess-1 │                                      │
│   sess-2 │  Assistant: 我先探索一下代码结构...   │
│          │  ┌─ explore ────────────────┐       │
│ Yesterday│  │ Found 5 files...         │       │
│   sess-3 │  └──────────────────────────┘       │
│          │                                      │
│          │  Assistant: 根据探索结果...          │
│          │                                      │
│          ├──────────────────────────────────────┤
│          │  Type a message...          [Send]   │
└──────────┴──────────────────────────────────────┘
```

## 安装引导（Phase 3）

首次启动 wizard：

1. 选择数据目录（默认 `~/.kako/`）
2. 配置默认模型 API Key
3. 选择基础 Agent
4. 安装示例 Skill

## Project Context

自动加载项目级上下文文件（优先级从高到低）：

1. `.kako/project.md`
2. `KAKO.md`
3. `.kako/KAKO.md`

在 `SessionStart` hook 中注入 system prompt。

## Phase 划分

| 能力 | Phase |
|------|-------|
| `kako chat` REPL | 1 |
| `kako config` | 1 |
| Tauri 对话页 | 2 |
| 日志 / 运行树页 | 2 |
| 记忆浏览 | 2 |
| 安装引导 | 3 |
| 成本仪表盘 | 3 |

## 待确认项

- [ ] UI 框架最终选择（默认 React + Tailwind）
- [ ] 对话页线框细节
- [ ] 是否支持暗色主题首版
