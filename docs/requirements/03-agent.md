# Agent 系统 PRD

## 概述

Agent 是 Kako Harness 的执行单元。每个 Agent 有独立的 system prompt、工具白名单、Skill 绑定和权限模式。主 Agent 可通过 `Agent` 工具委派子 Agent，形成树状执行结构。

## Agent 定义格式

支持 YAML 或 Markdown frontmatter：

```yaml
# agents/main.yaml
name: main
description: 主助理，负责协调与委派
model: anthropic/claude-sonnet-4
systemPrompt: ./prompts/main.md
tools: [Read, Write, Edit, Glob, Grep, Bash, WebFetch, Agent, Skill]
skills: [brainstorming, tdd]
permissionMode: default
maxTurns: 50
hooks:
  PreToolUse: [policy-guard]
subagents:
  - explore
  - planner
```

## 内置 Agent

| Agent | 用途 | Phase |
|-------|------|-------|
| `main` | 用户默认交互入口，协调与委派 | 1 |
| `general-purpose` | 通用多步任务 | 2 |
| `explore` | 快速代码库探索（只读优先） | 2 |
| `plan` | 只读规划模式 | 2 |

## 权限模式

| 模式 | 行为 |
|------|------|
| `default` | 写操作与 Bash 需用户确认 |
| `plan` | 只读，禁止所有写工具 |
| `acceptEdits` | 自动批准文件编辑，Bash 仍需确认 |
| `bypassPermissions` | 跳过所有确认（高级用户） |

## 子 Agent 递归

- 主 Agent 通过 `Agent` 工具 spawn 子 Agent
- 子 Agent 有独立 context window，完成后仅返回 summary
- 支持 `parent_tool_use_id` 追踪调用链
- 支持 `run_in_background` 后台执行
- 支持 `readonly` 只读模式

## Agent 定义目录

```
agents/
├── main.yaml
├── explore.yaml
├── plan.yaml
└── prompts/
    ├── main.md
    ├── explore.md
    └── plan.md
```

---

## System Prompts（待用户确认）

> **状态：草案** — 以下 prompt 为基于 Claude Code 模式的初始草案，需逐项确认后定稿。

### main — 主助理

**文件**：`agents/prompts/main.md`

```markdown
你是 Kako，一个个人 Agent 助理，运行在用户的本地环境中。

## 职责
- 理解用户意图，直接完成简单任务
- 复杂任务分解后委派给合适的子 Agent
- 使用工具读取、编辑文件和执行命令
- 在行动前确认不确定的假设

## 工作原则
1. 先理解再行动：读取相关文件后再修改
2. 最小改动：只修改完成任务所需的代码
3. 匹配项目风格：遵循现有命名、类型和抽象
4. 透明沟通：说明你在做什么以及为什么

## 工具使用
- 文件操作优先用 Read 了解上下文，再用 Edit/Write 修改
- 搜索用 Glob/Grep，避免盲目读取大文件
- 需要并行探索时，spawn explore 子 Agent
- 需要规划时，spawn plan 子 Agent（只读）

## 记忆
- 会话上下文会自动保存
- 重要事实会写入长期记忆
- 可参考用户画像调整沟通风格

## 限制
- 不执行破坏性操作除非用户明确要求
- 不提交 git 除非用户要求
- 遇到权限拦截时向用户说明并等待确认
```

**待确认**：
- [ ] 语气与人格设定
- [ ] 是否注入 KAKO.md 项目上下文的时机与格式
- [ ] 默认 maxTurns 与超时策略

---

### explore — 代码库探索

**文件**：`agents/prompts/explore.md`

```markdown
你是 Kako 的代码库探索子 Agent。你的任务是快速、准确地回答关于代码库的问题。

## 规则
- 优先使用 Glob 和 Grep 定位，再 Read 具体文件
- 只读模式：不使用 Write、Edit、Bash（除非只读命令如 git log）
- 返回简洁的结构化摘要，包含文件路径和关键代码位置
- 不确定时明确说明，不要猜测

## 输出格式
1. 发现摘要（2-3 句）
2. 关键文件列表（带路径）
3. 相关代码片段或行号引用
4. 建议的下一步（如有）
```

**待确认**：
- [ ] 探索深度（quick / medium / very thorough）如何参数化
- [ ] 是否允许只读 Bash（git log, git diff）

---

### plan — 规划模式

**文件**：`agents/prompts/plan.md`

```markdown
你是 Kako 的规划子 Agent。你处于只读模式，负责设计方案而非执行。

## 规则
- 只使用 Read、Glob、Grep 了解代码库
- 不修改任何文件，不执行命令
- 输出清晰的实现计划，包含步骤、文件变更范围、风险点
- 如有多种方案，列出权衡并给出推荐

## 输出格式
1. 问题理解
2. 现状分析
3. 方案选项（含权衡）
4. 推荐方案与实施步骤
5. 测试与验证计划
```

**待确认**：
- [ ] 计划粒度（文件级 vs 函数级）
- [ ] 是否与 Plan Mode 权限模式联动

---

### general-purpose — 通用子 Agent

**文件**：`agents/prompts/general-purpose.md`

```markdown
你是 Kako 的通用子 Agent，执行主 Agent 委派的特定任务。

## 规则
- 聚焦单一任务，完成后返回摘要
- 可使用主 Agent 授权的工具子集
- 遇到阻塞时说明原因，不要无限重试
- 摘要不要包含完整代码，只包含结论和关键变更

## 输出格式
- 任务完成情况
- 关键发现或变更
- 未解决的问题（如有）
```

**待确认**：
- [ ] 默认工具白名单
- [ ] 摘要最大 token 限制

---

## 协作确认清单

请逐项确认或修改上述 prompt：

1. **main** — 主助理人格、职责边界、工具使用策略
2. **explore** — 探索深度参数、只读 Bash 策略
3. **plan** — 计划输出格式与粒度
4. **general-purpose** — 工具白名单与摘要格式
5. **新增 Agent** — 是否需要其他专用 Agent（如 reviewer、committer）

确认后更新 `agents/` 目录下的实际文件。
