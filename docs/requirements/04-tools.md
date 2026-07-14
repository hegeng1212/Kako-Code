# Tool 系统 PRD

## 概述

Tools 是 Agent 与外部世界交互的接口。每个 Tool 有 JSON Schema 定义的输入/输出、执行沙箱约束和审计日志。

## Tool 定义格式

```typescript
interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  outputSchema?: JsonSchema;
  requiresConfirmation?: boolean;
  sandbox?: ToolSandbox;
}
```

## 内置 Tool 清单（草案，待确认）

### 文件操作

#### Read

读取文件内容。

| 属性 | 值 |
|------|-----|
| 确认 | 否 |
| Phase | 1 |

```json
{
  "path": { "type": "string", "description": "文件绝对或相对路径" },
  "offset": { "type": "integer", "description": "起始行号（1-based）" },
  "limit": { "type": "integer", "description": "读取行数" }
}
```

**执行语义**：
- 支持文本文件读取，大文件通过 offset/limit 分页
- 支持图片文件（返回 base64 或路径引用，Phase 2）
- 路径必须在 sandbox allowlist 内
- 文件不存在返回明确错误

**待确认**：
- [ ] 是否支持二进制文件
- [ ] 默认单次读取行数上限

---

#### Write

创建或覆写文件。

| 属性 | 值 |
|------|-----|
| 确认 | 是（`acceptEdits` 模式自动批准） |
| Phase | 1 |

```json
{
  "path": { "type": "string" },
  "contents": { "type": "string" }
}
```

**执行语义**：
- 自动创建父目录
- 覆写已有文件
- 记录变更到 tool 日志

**待确认**：
- [ ] 是否支持 append 模式
- [ ] 大文件写入限制

---

#### Edit

对文件做精确字符串替换。

| 属性 | 值 |
|------|-----|
| 确认 | 是 |
| Phase | 1 |

```json
{
  "path": { "type": "string" },
  "old_string": { "type": "string" },
  "new_string": { "type": "string" },
  "replace_all": { "type": "boolean", "default": false }
}
```

**执行语义**：
- `old_string` 必须在文件中唯一匹配（除非 `replace_all: true`）
- 匹配失败返回错误，不修改文件

**待确认**：
- [ ] 是否支持正则替换

---

### 搜索

#### Grep

在文件中搜索正则模式。

| 属性 | 值 |
|------|-----|
| 确认 | 否 |
| Phase | 1 |

```json
{
  "pattern": { "type": "string" },
  "path": { "type": "string" },
  "glob": { "type": "string" },
  "output_mode": { "enum": ["content", "files_with_matches", "count"] },
  "head_limit": { "type": "integer" }
}
```

**待确认**：
- [ ] 使用 ripgrep 还是 Node 原生实现

---

### 执行

#### Bash

执行 shell 命令。

| 属性 | 值 |
|------|-----|
| 确认 | 是 |
| Phase | 1 |

```json
{
  "command": { "type": "string" },
  "description": { "type": "string", "description": "命令用途说明" },
  "working_directory": { "type": "string" },
  "timeout_ms": { "type": "integer", "default": 30000 }
}
```

**执行语义**：
- 默认 timeout 30s，可配置
- 捕获 stdout/stderr
- 禁止交互式命令（`-i` flag 等）
- sandbox：cwd 限制、命令 allowlist（Phase 2）

**待确认**：
- [ ] 默认 timeout
- [ ] 是否支持后台命令（`block_until_ms: 0`）
- [ ] 网络访问策略（sandbox 默认禁止？）

---

### 网络

#### WebFetch

获取 URL 内容并转为可读格式。

| 属性 | 值 |
|------|-----|
| 确认 | 否 |
| Phase | 2 |

```json
{
  "url": { "type": "string" },
  "method": { "enum": ["GET"], "default": "GET" }
}
```

**待确认**：
- [ ] 是否支持 POST
- [ ] 内容大小限制

---

### Agent 编排

#### Agent

Spawn 子 Agent 执行任务。

| 属性 | 值 |
|------|-----|
| 确认 | 否 |
| Phase | 2 |

```json
{
  "description": { "type": "string", "description": "3-5 词任务摘要" },
  "prompt": { "type": "string" },
  "subagent_type": { "type": "string", "enum": ["general-purpose", "explore", "plan"] },
  "model": { "type": "string" },
  "readonly": { "type": "boolean" },
  "run_in_background": { "type": "boolean" }
}
```

---

#### Skill

激活并执行 Skill。

| 属性 | 值 |
|------|-----|
| 确认 | 否 |
| Phase | 2 |

```json
{
  "skill": { "type": "string", "description": "Skill 名称" },
  "args": { "type": "string", "description": "传递给 Skill 的参数" }
}
```

---

### 记忆

#### Memory

查询或写入记忆。

| 属性 | 值 |
|------|-----|
| 确认 | 否 |
| Phase | 2 |

```json
{
  "action": { "enum": ["recall", "append", "consolidate"] },
  "query": { "type": "string" },
  "layers": { "type": "array", "items": { "type": "string" } },
  "content": { "type": "string" }
}
```

**待确认**：
- [ ] Memory tool 是否暴露给 Agent，还是仅 Harness 内部调用

---

## 沙箱与权限

| 约束 | 说明 |
|------|------|
| cwd | 默认 session cwd，不可越界 |
| timeout | 每工具可配置，Bash 默认 30s |
| allowlist | 文件路径 glob 白名单 |
| 确认 | `requiresConfirmation` + permissionMode 联动 |

## Hook 集成

| 事件 | 用途 |
|------|------|
| PreToolUse | 权限拦截、参数改写 |
| PostToolUse | 审计日志 |
| PostToolUseFailure | 错误处理 |

## 日志

每次调用记录到 `~/.kako/logs/tools/{date}.jsonl`：

```json
{
  "timestamp": "2026-07-03T10:00:00Z",
  "sessionId": "...",
  "agentId": "...",
  "toolUseId": "...",
  "toolName": "Read",
  "input": { "path": "src/index.ts" },
  "output": "...",
  "status": "success",
  "durationMs": 12
}
```

## 协作确认清单

请逐项确认或修改：

1. **Read** — 分页策略、二进制支持、行数上限
2. **Write** — append 模式、大小限制
3. **Edit** — 正则支持
4. **Grep** — ripgrep vs 原生实现
5. **Bash** — timeout、后台命令、网络策略
6. **WebFetch** — 方法与大小限制
7. **Memory** — 是否作为 Agent 可见工具
8. **新增 Tool** — 是否需要其他工具（Task、TodoWrite、Browser 等）

确认后更新本文档并生成 `@kako/core` 中的 Tool 实现规格。
