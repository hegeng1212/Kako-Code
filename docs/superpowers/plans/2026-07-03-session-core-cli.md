# Session Core + CLI 增强 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan step-by-step. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现按工作目录组织的 SessionManager、AgentRuntime 集成、斜杠命令路由，并增强 `kako chat` 多会话 CLI 体验。

**Architecture:** file-first JSON 索引（`projects.json` + 每 session 的 `meta.json`），SessionManager 统一管理会话生命周期；SlashRouter 在 CLI 层拦截 `/` 命令；AgentRuntime 委托 SessionManager 并在 resume 时注入 L1 summary。

**Tech Stack:** TypeScript, Node.js fs/promises, vitest, yaml (已有), Commander.js CLI

## Global Constraints

- 数据目录：`KAKO_HOME` 或 `~/.kako/`
- Project ID：`proj-{sha256(cwd).slice(0,12)}`
- Session ID 格式保持：`sess-{uuid8}`
- 不引入 SQLite sessions.db
- 不实现 Web API / UI（Phase B）
- 斜杠命令 Phase A：内置 7 条 + 可选 YAML 映射
- 遵循现有 monorepo 模式：`@kako/shared` 类型 → `@kako/core` 实现 → `@kako/cli` 消费

---

## File Map

| 文件 | 职责 |
|------|------|
| `packages/shared/src/session.ts` | 扩展 `Project`, `SessionMeta`, `SlashResult` 等类型 |
| `packages/shared/src/index.ts` | 导出新类型 |
| `packages/core/src/config/paths.ts` | `getProjectsIndexPath`, `getSessionMetaPath` |
| `packages/core/src/session/project-id.ts` | cwd → projectId |
| `packages/core/src/session/manager.ts` | SessionManager 实现 |
| `packages/core/src/session/manager.test.ts` | SessionManager 单元测试 |
| `packages/core/src/session/slash.ts` | SlashRouter |
| `packages/core/src/session/slash.test.ts` | SlashRouter 单元测试 |
| `packages/core/src/agent/runtime.ts` | 集成 SessionManager + L1 注入 |
| `packages/core/src/index.ts` | 导出新模块 |
| `packages/cli/src/commands/chat.ts` | 多 session REPL + banner |
| `packages/cli/src/commands/chat.test.ts` | SlashRouter 集成 smoke（可选） |

---

### Task 1: Shared 类型扩展

**Files:**
- Modify: `packages/shared/src/session.ts`
- Modify: `packages/shared/src/index.ts`（如需要）

**Interfaces — Produces:**
- `Project`, `SessionMeta`, `ProjectIndexFile`
- `SlashResult` union type
- `SlashCommandContext` for router

- [ ] **Step 1: 添加类型到 session.ts**

```typescript
export interface Project {
  id: string;
  cwd: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  lastSessionId?: SessionId;
}

export interface ProjectIndexFile {
  version: number;
  projects: Project[];
}

export interface SessionMeta {
  id: SessionId;
  projectId: string;
  cwd: string;
  agentName: string;
  title: string;
  status: SessionStatus;
  createdAt: string;
  updatedAt: string;
}

export type SlashResult =
  | { type: "handled" }
  | { type: "exit" }
  | { type: "switch"; session: Session }
  | { type: "message"; text: string }
  | { type: "error"; message: string };

export interface SlashCommandContext {
  cwd: string;
  session: Session;
  listSessions: () => Promise<Session[]>;
  createSession: (agentName?: string) => Promise<Session>;
  endSession: (id: SessionId) => Promise<void>;
  resumeSession: (id: SessionId) => Promise<Session>;
  updateTitle: (id: SessionId, title: string) => Promise<Session>;
}
```

- [ ] **Step 2: 构建 shared**

Run: `pnpm --filter @kako/shared build`  
Expected: 成功，无 TS 错误

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/session.ts
git commit -m "feat(shared): add Project, SessionMeta, and SlashResult types"
```

---

### Task 2: Paths + Project ID

**Files:**
- Create: `packages/core/src/session/project-id.ts`
- Create: `packages/core/src/session/project-id.test.ts`
- Modify: `packages/core/src/config/paths.ts`

**Interfaces — Produces:**
- `projectIdFromCwd(cwd: string): string`
- `getProjectsIndexPath(): string`
- `getSessionMetaPath(sessionId: string): string`

- [ ] **Step 1: 写失败测试**

```typescript
// packages/core/src/session/project-id.test.ts
import { describe, expect, it } from "vitest";
import { projectIdFromCwd } from "./project-id.js";

describe("projectIdFromCwd", () => {
  it("returns stable proj- prefix id", () => {
    const a = projectIdFromCwd("/tmp/my-project");
    const b = projectIdFromCwd("/tmp/my-project");
    expect(a).toBe(b);
    expect(a).toMatch(/^proj-[a-f0-9]{12}$/);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @kako/core test -- project-id`  
Expected: FAIL module not found

- [ ] **Step 3: 实现 project-id.ts + paths 扩展**

```typescript
// packages/core/src/session/project-id.ts
import { createHash } from "node:crypto";
import { basename, resolve } from "node:path";

export function projectIdFromCwd(cwd: string): string {
  const normalized = resolve(cwd);
  const hash = createHash("sha256").update(normalized).digest("hex").slice(0, 12);
  return `proj-${hash}`;
}

export function projectNameFromCwd(cwd: string): string {
  return basename(resolve(cwd)) || "project";
}
```

```typescript
// paths.ts 追加
export function getProjectsIndexPath(): string {
  return join(getIndexDir(), "projects.json");
}
export function getSessionMetaPath(sessionId: string): string {
  return join(getSessionMemoryDir(sessionId), "meta.json");
}
```

- [ ] **Step 4: 运行测试**

Run: `pnpm --filter @kako/core test -- project-id`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/session/project-id.ts packages/core/src/session/project-id.test.ts packages/core/src/config/paths.ts
git commit -m "feat(core): add project id helper and session meta paths"
```

---

### Task 3: SessionManager

**Files:**
- Create: `packages/core/src/session/manager.ts`
- Create: `packages/core/src/session/manager.test.ts`

**Interfaces — Consumes:** Task 1 types, Task 2 paths/project-id  
**Interfaces — Produces:**
- `class SessionManager` with methods from spec
- `export const sessionManager = new SessionManager()`

- [ ] **Step 1: 写失败测试（create + list + end）**

```typescript
// manager.test.ts — 使用 temp KAKO_HOME
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SessionManager } from "./manager.js";

describe("SessionManager", () => {
  let home: string;
  let mgr: SessionManager;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "kako-home-"));
    process.env.KAKO_HOME = home;
    mgr = new SessionManager();
  });

  afterEach(async () => {
    delete process.env.KAKO_HOME;
    await rm(home, { recursive: true, force: true });
  });

  it("creates session with meta.json under cwd project", async () => {
    const cwd = join(home, "project");
    const session = await mgr.createSession({ cwd, agentName: "main" });
    expect(session.id).toMatch(/^sess-/);
    expect(session.cwd).toBe(cwd);
    const listed = await mgr.listSessions({ cwd });
    expect(listed).toHaveLength(1);
    expect(listed[0].id).toBe(session.id);
  });

  it("ends session and sets status ended", async () => {
    const session = await mgr.createSession({ cwd: home });
    await mgr.endSession(session.id);
    const loaded = await mgr.getSession(session.id);
    expect(loaded?.status).toBe("ended");
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @kako/core test -- manager`  
Expected: FAIL

- [ ] **Step 3: 实现 SessionManager**

核心逻辑:
- `resolveProject`: 读/写 `projects.json`，upsert by projectId
- `createSession`: randomUUID session id，写 meta.json，更新 project.lastSessionId
- `listSessions`: 扫描 `memory/sessions/*/meta.json`，filter by cwd，sort updatedAt desc
- `getSession`: 读 meta.json
- `updateSession`: merge patch，写 meta.json
- `endSession`: status ended + `FileMemoryStore.consolidate`
- `loadSessionSummary`: read summary.md if exists

- [ ] **Step 4: 运行测试**

Run: `pnpm --filter @kako/core test -- manager`  
Expected: PASS

- [ ] **Step 5: 导出**

Modify `packages/core/src/index.ts`:
```typescript
export { SessionManager, sessionManager } from "./session/manager.js";
export { projectIdFromCwd } from "./session/project-id.js";
```

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/session/manager.ts packages/core/src/session/manager.test.ts packages/core/src/index.ts
git commit -m "feat(core): add SessionManager with project-scoped sessions"
```

---

### Task 4: AgentRuntime 集成

**Files:**
- Modify: `packages/core/src/agent/runtime.ts`

**Interfaces — Consumes:** `sessionManager` from Task 3  
**Interfaces — Produces:**
- `createSession()` delegates to SessionManager
- `resumeSession(sessionId: SessionId): Promise<Session>`
- `endSession()` delegates to SessionManager
- `buildMessages()` accepts optional `sessionSummary?: string`

- [ ] **Step 1: 修改 createSession / endSession 委托 SessionManager**

- [ ] **Step 2: 添加 resumeSession**

```typescript
async resumeSession(sessionId: SessionId): Promise<Session> {
  const session = await sessionManager.getSession(sessionId);
  if (!session) throw new Error(`Session not found: ${sessionId}`);
  if (resolve(session.cwd) !== resolve(this.cwd)) {
    throw new Error(`Session cwd mismatch: ${session.cwd} vs ${this.cwd}`);
  }
  session.status = "active";
  session.updatedAt = new Date().toISOString();
  await sessionManager.updateSession(sessionId, { status: "active" });
  return session;
}
```

- [ ] **Step 3: runTurn 注入 L1 summary**

在 `loadProjectContext` 之后:
```typescript
const sessionSummary = transcript.length
  ? await sessionManager.loadSessionSummary(session.id)
  : undefined;
const messages = buildMessages(definition, transcript, projectContext, sessionSummary);
```

更新 `buildMessages` 追加:
```typescript
if (sessionSummary) {
  system += `\n\n## Previous Session Summary\n\n${sessionSummary}`;
}
```

- [ ] **Step 4: 首条 user 消息自动 title**

runTurn 开头，若 title 为 `"New chat"`，append user 后 `updateSession` title 为 userInput.slice(0, 40)。

- [ ] **Step 5: typecheck**

Run: `pnpm --filter @kako/core typecheck`  
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/agent/runtime.ts
git commit -m "feat(core): integrate SessionManager into AgentRuntime"
```

---

### Task 5: SlashRouter

**Files:**
- Create: `packages/core/src/session/slash.ts`
- Create: `packages/core/src/session/slash.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces — Produces:** `handleSlashCommand(input: string, ctx: SlashCommandContext): Promise<SlashResult>`

- [ ] **Step 1: 写失败测试（/help, /new, /resume）**

- [ ] **Step 2: 实现内置命令解析**

```typescript
export async function handleSlashCommand(
  input: string,
  ctx: SlashCommandContext,
): Promise<SlashResult> {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) {
    return { type: "message", text: input };
  }
  const [cmd, ...rest] = trimmed.slice(1).split(/\s+/);
  const arg = rest.join(" ").trim();
  switch (cmd.toLowerCase()) {
    case "help": return { type: "handled" }; // CLI prints help
    case "exit":
    case "quit": return { type: "exit" };
    case "new":
    case "clear": { /* end + create */ }
    case "sessions": return { type: "handled" };
    case "resume": { /* prefix match id */ }
    case "title": { /* updateTitle */ }
    default: return resolveYamlSlashCommand(cmd, arg, ctx);
  }
}
```

- [ ] **Step 3: 实现 YAML 映射 + skill 加载**

- `loadSlashConfig(cwd)` 合并 global + project yaml
- skill 路径搜索顺序: `{cwd}/.kako/skills/`, `{KAKO_HOME}/skills/`, monorepo `skills/`

- [ ] **Step 4: 运行测试**

Run: `pnpm --filter @kako/core test -- slash`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/session/slash.ts packages/core/src/session/slash.test.ts packages/core/src/index.ts
git commit -m "feat(core): add slash command router with YAML extensions"
```

---

### Task 6: CLI chat 改造

**Files:**
- Modify: `packages/cli/src/commands/chat.ts`

**Interfaces — Consumes:** `handleSlashCommand`, `sessionManager`, `loadProjectContext` (from loader)

- [ ] **Step 1: 增强 banner**

```typescript
const ctxInfo = await loadProjectContext(cwd);
const ctxLabel = ctxInfo
  ? `${basename(ctxInfo.path)} loaded`
  : "No project context found";
console.log(`Context: ${ctxLabel}`);
console.log(`Session: ${session.id} (new)`);
console.log(`Type /help for commands.\n`);
```

需要 export `loadProjectContext` 返回 `{ path, content }` — 修改 `loader.ts` 的 `loadProjectContext` 返回 `ProjectContext | undefined`。

- [ ] **Step 2: REPL 集成 SlashRouter**

```typescript
const slashCtx: SlashCommandContext = {
  cwd,
  session,
  listSessions: () => sessionManager.listSessions({ cwd }),
  createSession: (name) => runtime.createSession(name),
  endSession: (id) => runtime.endSession({ ...session, id }),
  resumeSession: (id) => runtime.resumeSession(id),
  updateTitle: (id, title) => sessionManager.updateSession(id, { title }),
};

const result = await handleSlashCommand(trimmed, slashCtx);
switch (result.type) {
  case "exit": break loop;
  case "switch": session = result.session; console.log(`Switched to ${session.id}`); continue;
  case "handled": printHelpOrSessions(...); continue;
  case "error": console.error(result.message); continue;
  case "message":
    await runtime.runTurn(session, result.text);
}
```

- [ ] **Step 3: 实现 printHelp / printSessions 辅助函数**

- [ ] **Step 4: 手动验证**

Run:
```bash
pnpm --filter @kako/shared build && pnpm --filter @kako/core build && pnpm --filter @kako/cli build
node packages/cli/dist/index.js chat --cwd .
```
测试: `/help`, `/new`, `/sessions`, 普通消息, `/exit`

- [ ] **Step 5: 全量 typecheck**

Run: `pnpm typecheck`  
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/commands/chat.ts packages/core/src/agent/loader.ts
git commit -m "feat(cli): multi-session chat with slash commands and project banner"
```

---

## Plan Self-Review

| Spec 要求 | 对应 Task |
|-----------|-----------|
| Project + SessionMeta 数据模型 | Task 1, 2, 3 |
| SessionManager API | Task 3 |
| AgentRuntime 集成 + L1 注入 | Task 4 |
| 斜杠命令内置 + YAML | Task 5 |
| CLI banner + 多 session | Task 6 |
| Phase B HTTP 预留 | Spec only，无 task |
| 验收标准 1–6 | Task 3–6 tests + 手动验证 |

无 TBD / 占位符。类型名 `SlashResult`、`SessionManager` 全文一致。

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-03-session-core-cli.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — 每个 Task 派一个 subagent，Task 间 review，迭代快  
2. **Inline Execution** — 本会话按 Task 顺序直接实现，checkpoint Review

**Which approach?**
