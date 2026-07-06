# Session Core + CLI 增强 — 设计规格

**日期:** 2026-07-03  
**阶段:** Phase A（Session Core + CLI；Web 对话 Phase B）  
**状态:** 已批准

## 背景

Kako 已有 `kako chat` REPL、`AgentRuntime` 工具循环、L0 transcript 持久化、KAKO.md 项目上下文注入。缺口是会话管理（按工作目录组织、恢复切换）、CLI 多会话体验、斜杠命令路由。Web 对话页将在 Phase B 复用同一 SessionManager 与数据模型。

## 目标

1. 引入 **SessionManager**：按工作目录（项目）组织会话，按 sessionId 隔离上下文。
2. 增强 **CLI `kako chat`**：Claude Code 风格 banner、多会话、斜杠命令。
3. 为 Phase B Web 对话预留数据模型与 core API（本阶段不实现 HTTP）。

## 非目标（Phase A）

- Web 聊天 UI 与 Session REST/SSE API
- 完整 Skill Registry / `kako skill install`
- Sub-agent、Hooks 引擎
- L2–L5 记忆层
- SQLite `sessions.db`（采用 file-first JSON 索引）

## 架构决策

**选用方案：JSON 索引 + 文件 meta（file-first）**

- 与现有 `FileMemoryStore`、ADR-002 file-first 记忆一致
- 无需新增 SQLite 依赖
- CLI 与后续 Web 共用同一磁盘布局

## 数据模型

### Project（工作目录）

```typescript
interface Project {
  id: string;           // proj-{hash12}，cwd 绝对路径 SHA-256 前 12 位
  cwd: string;          // 绝对路径（resolve 后）
  name: string;         // 目录 basename，可后续扩展重命名
  createdAt: string;    // ISO 8601
  updatedAt: string;
  lastSessionId?: SessionId;
}
```

**索引文件:** `~/.kako/index/projects.json`

```json
{
  "version": 1,
  "projects": [Project]
}
```

### SessionMeta

**路径:** `~/.kako/memory/sessions/{sessionId}/meta.json`

```typescript
interface SessionMeta {
  id: SessionId;
  projectId: string;
  cwd: string;
  agentName: string;
  title: string;
  status: SessionStatus;  // "active" | "paused" | "ended"
  createdAt: string;
  updatedAt: string;
}
```

**同目录已有:**

- `transcript.jsonl` — L0 对话历史
- `summary.md` — L1 会话摘要（endSession 时生成）

### Session 与 Meta 关系

- `Session`（`@kako/shared`）为运行时对象，字段与 `SessionMeta` 对齐。
- 新建 session 时同时写 `meta.json` 与空 transcript 目录。
- `title` 默认 `"New chat"`；首条 user 消息后可自动截断更新（≤40 字符）。

### Project ID 生成

```typescript
function projectIdFromCwd(cwd: string): string {
  const normalized = resolve(cwd);
  const hash = createHash("sha256").update(normalized).digest("hex").slice(0, 12);
  return `proj-${hash}`;
}
```

## 目录布局

```
~/.kako/
├── index/
│   └── projects.json
└── memory/sessions/{sessionId}/
    ├── meta.json
    ├── transcript.jsonl
    └── summary.md
```

## SessionManager API

**模块:** `packages/core/src/session/manager.ts`

| 方法 | 说明 |
|------|------|
| `resolveProject(cwd: string): Promise<Project>` | 注册或更新 project 索引 |
| `createSession(opts: SessionStartOptions): Promise<Session>` | 新建 session + meta.json |
| `getSession(id: SessionId): Promise<Session \| null>` | 读 meta |
| `listSessions(opts?: { cwd?: string; status?: SessionStatus; limit?: number }): Promise<Session[]>` | 按 cwd 过滤，updatedAt 降序 |
| `updateSession(id, patch: Partial<Pick<SessionMeta, "title" \| "status">>): Promise<Session>` | 更新 meta |
| `endSession(id: SessionId): Promise<void>` | status→ended，调用 FileMemoryStore.consolidate |
| `loadSessionSummary(id: SessionId): Promise<string \| undefined>` | 读 summary.md |

**导出:** 从 `@kako/core` index 导出 `SessionManager` 单例或工厂。

## AgentRuntime 集成

**文件:** `packages/core/src/agent/runtime.ts`

变更:

1. 构造函数注入 `SessionManager`（默认使用模块单例）。
2. `createSession(agentName?)` → 委托 `SessionManager.createSession({ cwd, agentName })`。
3. 新增 `resumeSession(sessionId: SessionId): Promise<Session>` — 加载 meta，校验 cwd 一致，status→active。
4. `runTurn()` — 若存在 `summary.md` 且 transcript 非空，在 system prompt 追加 `## Previous Session Summary`（resume 场景）。
5. `endSession()` — 委托 `SessionManager.endSession`，写 meta.status=ended。
6. 首条 user 消息后，若 title 仍为默认值，自动更新 title。

**KAKO.md:** 继续使用 `loadProjectContext(session.cwd)`，每 turn 注入（已有逻辑不变）。

## 斜杠命令（SlashRouter）

**模块:** `packages/core/src/session/slash.ts`

输入以 `/` 开头时，CLI 在 `runTurn` 之前路由。

### Phase A 内置命令

| 命令 | 行为 |
|------|------|
| `/help` | 打印命令列表 |
| `/exit`, `/quit` | 结束当前 session，退出 REPL |
| `/new` | end 当前 session，同 cwd 新建 |
| `/clear` | 同 `/new`（语义：清空当前对话） |
| `/sessions` | 列出当前 cwd 下 session（id、title、status、updatedAt） |
| `/resume <id>` | 切换到指定 session（前缀匹配 id） |
| `/title <text>` | 设置当前 session 标题 |

### YAML 扩展（轻量）

读取顺序（后者覆盖前者）:

1. `~/.kako/config/skills.yaml`
2. `{cwd}/.kako/config/skills.yaml`

格式:

```yaml
slashCommands:
  commit: |
    请根据当前 git diff 生成 commit message 并说明理由。
  review: code-review   # 技能名 → 加载 SKILL.md 正文作为 user 消息
```

- 值为多行字符串 → 直接作为 user 消息发给 `runTurn`。
- 值为技能名 → 从 `{cwd}/.kako/skills/`、`~/.kako/skills/`、monorepo `skills/` 查找 `{name}/SKILL.md`，读取正文作为 user 消息。
- 找不到映射 → 提示 unknown command。

**返回类型:**

```typescript
type SlashResult =
  | { type: "handled" }                    // 已处理，不调用 LLM
  | { type: "exit" }
  | { type: "switch"; session: Session }   // 切换 session
  | { type: "message"; text: string }      // 展开为 LLM 输入
  | { type: "error"; message: string };
```

## CLI 体验（`kako chat`）

**文件:** `packages/cli/src/commands/chat.ts`

### 启动

```
Kako v0.2.0 — Agent: main (ProviderName / model)
Project: /absolute/path/to/project
Context: KAKO.md loaded          # 或 "No project context found"
Session: sess-a1b2c3d4 (new)
Type /help for commands.
```

- `--cwd <path>` 已有，默认 `process.cwd()`。
- 启动时 `resolveProject(cwd)` + `createSession()`。

### REPL 循环

```
> 用户输入
  → SlashRouter.handle(input, ctx)
  → handled / exit / switch → 不调用 LLM
  → message → runTurn(session, text)
  → 普通文本 → runTurn(session, input)
```

### 退出

- `/exit` 或 Ctrl+D：endSession，打印 `Session saved.`

## 上下文管理

| 层级 | 存储 | 作用 |
|------|------|------|
| Project | KAKO.md / .kako/project.md | 每 turn system 注入 |
| L0 | transcript.jsonl | 当前 session 完整历史 |
| L1 | summary.md | resume 且有历史时 system 注入摘要 |
| 隔离 | sessionId | 不同 session  transcript 完全独立 |

## Phase B 预留（本阶段不实现）

HTTP API 设计草案（供 Web 复用 SessionManager）:

```
GET  /api/projects
POST /api/projects              { cwd }
GET  /api/projects/:id/sessions
POST /api/sessions              { cwd, agentName? }
GET  /api/sessions/:id
POST /api/sessions/:id/turn     → SSE (text_delta, tool_start, tool_end, done)
POST /api/sessions/:id/end
```

## 错误处理

- `resume` 找不到 session → 提示并保持在当前 session。
- session cwd 与 CLI `--cwd` 不一致 → 拒绝 resume，提示 cwd 不匹配。
- meta.json 损坏 → 跳过该 session，list 时 log warning。
- 斜杠命令参数缺失 → 返回 `{ type: "error", message }` 打印到终端。

## 测试策略

- `SessionManager` 单元测试：temp `KAKO_HOME`，验证 create/list/end/resume。
- `SlashRouter` 单元测试：内置命令、YAML 映射、skill 展开。
- `AgentRuntime` 集成测试（可选）：resume 后 transcript 延续。
- 手动：`kako chat --cwd <project>` 多 session 切换。

## 迁移

- 已有 `~/.kako/memory/sessions/{id}/` 无 meta.json：list 时忽略；不自动迁移。
- 新 session 一律写 meta.json。

## 验收标准

1. `kako chat --cwd /path` 显示 project、KAKO.md 状态、session id。
2. 同 cwd 可 `/new`、`/sessions`、`/resume` 切换，上下文隔离。
3. `/exit` 后 transcript 与 summary 落盘，meta.status=ended。
4. resume 的 session 可继续对话，历史 messages 仍在 LLM 上下文。
5. `/help` 与 YAML 斜杠映射可用。
6. `pnpm --filter @kako/core test` 通过。
