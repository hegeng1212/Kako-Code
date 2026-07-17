# 工程原则

本文档定义 Kako 仓库的开发规范。所有功能实现、Bug 修复和重构都应遵守。

## 禁止打补丁式解决问题

**核心原则：在正确的层次修复问题，而不是用代码绕过症状。**

「打补丁」指：当模型、工具契约或 UX 行为不符合预期时，在运行时额外加一层启发式逻辑去「纠正」或「替它做决定」，而不是改 prompt、改工具描述、改状态机或改架构。

### 禁止的做法

| 类型 | 示例 | 为何禁止 |
|------|------|----------|
| 语义 guard | 用正则/关键词判断用户是否在打招呼，在代码里 block `AskUserQuestion` | 业务语义属于模型决策，不应硬编码在 harness |
| Harness 代劳 | 模型没调工具时，harness 强行代开选择器或注入假 tool call | 绕过模型，行为不可预测，难维护 |
| 运行时纠偏 | 每轮额外注入 `[system-reminder]` 纠正模型用法 | 与 agent prompt / tool description 重复，且规则分散 |
| 启发式重试 | 检测 assistant 输出「像选项列表」就 rollback 并重试 | 把 prompt 问题变成隐式状态机，测试也会编码错误语义 |
| 症状掩盖 | 对某一模型/某一输入 special-case，不查根因 | 补丁会叠加，最终无人能理解全局行为 |

### 正确的做法

1. **Agent 行为** → 改 `agents/prompts/` 与 agent 配置
2. **工具何时可用、参数含义** → 改 tool `description` 与 JSON schema
3. **交互契约（Esc / 选中 / Ctrl+C）** → 改 CLI 状态机与 loop 生命周期（这是 UX，不是语义 guard）
4. **协议/解析 Bug** → 修 parser、stream、tool handler 本身
5. **架构缺口** → 设计 ADR，在对应模块一次性实现

### 判断标准

在提交代码前自问：

- 这段逻辑是在**定义契约**，还是在**猜测用户/模型意图**？
- 去掉这段代码，问题是否会在 prompt/工具层重新暴露？若是，应去那一层修。
- 新同事能否从 prompt + tool schema 理解行为，而不必读 hidden guard？

任一条答「否」或「不确定」，优先重构，不要加 patch。

### 反例（打补丁，已移除，勿再引入）

```typescript
// ❌ 用正则判断「你好」并 block 工具
if (isConversationalUserMessage(userMsg)) {
  return "AskUserQuestion is not for greetings...";
}

// ❌ 模型写了列表就 harness 代开 picker
if (shouldRetryAskUserQuestion(userMsg, turnText)) {
  await runHarnessAskUserQuestionFallback(...);
}
```

```typescript
// ✅ 工具 description 说明边界，由模型决定是否调用
export const askUserQuestionToolDefinition = {
  description: "Use this tool only when you are blocked on a decision...",
  ...
};

// ✅ Esc 只影响交互状态，不替模型做语义判断
if (askUserQuestionOutputDeclined(output)) {
  responseText = rollbackResponse(responseText, callbacks);
  break;
}
```

## 禁止枚举式解决问题

**核心原则：绝对不允许用枚举（列表、正则、关键词、分支表、特例表）来覆盖业务场景。枚举无法穷尽全部情况，必然过拟合；换一个措辞相近的问题就会再次失效。**

这里的「枚举」包括一切**按具体场景名、具体话术、具体工具名、具体领域**写死的分支，而不是指 TypeScript `enum` 类型本身。

### 禁止的做法

| 类型 | 示例 | 为何禁止 |
|------|------|----------|
| 关键词 / 正则路由 | `if (/brainstorm\|理清思路\|AI功能/.test(prompt))` 决定走哪条工具链 | 只能覆盖写进列表的几种说法，换说法即失效 |
| 问题 / 领域特例 prompt | 在 tool description 或 `main.md` 里写「用户说 *我想做一个 AI 功能* 时必须先…」 | prompt 变成案例手册，模型与维护者都只记住样例 |
| 工具名 / 来源特例 | 仅对 `mcp/*` 或某个 MCP 工具在 harness 里自动弹选择器 | 同类歧义在 Bash、Read、Agent 结果上仍会复发 |
| 输出形态特例 | 检测某工具返回「像两个宝宝」就触发专用 UI | 枚举输出格式，无法泛化到 N 选 1 |
| 委托 / 拦截白名单 | `rejectScopingDelegation` 一类按任务描述关键词 block `Agent` | 合法委托被误杀，未列出的场景仍漏网 |
| 测试即规范 | 用「宝宝 / PRD / 应用场景」等域数据当唯一验收路径 | 测试通过不等于通用契约成立 |

### 正确的做法

1. **定义通用契约** — 工具输入/输出格式、交互状态机、loop 生命周期；不写「当问题是 A 时」。
2. **模型编排** — 工具返回什么，由**模型**读结果后决定下一步调哪个工具（含 `AskUserQuestion`）；harness 不替模型做场景判断。
3. **单一机制复用** — 例如「2–4 个选项 → 调 `AskUserQuestion`」适用于任意来源的工具结果，不绑定 MCP、不绑定产品 scoping。
4. **Prompt 写规则不写样例** — 说明何时用、何时不用、交互形态；**不要**嵌入具体用户原话或垂直领域示例当逻辑分支。
5. **测试用中性数据** — `Option A/B`、通用问句；域场景留给用户真实会话验证，不作为代码分支依据。

### 判断标准

- 新增逻辑是否在匹配**某一类具体说法/工具/领域**？若是，改为通用契约或交给模型。
- 删掉枚举表后，系统是否仍有明确、可文档化的行为？若否，说明缺的是机制而不是再多几条 `if`。
- 换一个同义问法，行为是否仍正确？若依赖原句才正确，即为过拟合，必须重写。

### 反例（已移除，勿再引入）

```typescript
// ❌ 枚举任务类型，拦截 Agent 委托
const SCOPING_PATTERN = /brainstorm|理清|需求梳理|AI功能/i;
if (SCOPING_PATTERN.test(prompt)) throw new Error("use AskUserQuestion");

// ❌ 仅 MCP 工具结果触发选择器
if (toolCall.name.startsWith("mcp/")) {
  output = await resolveToolOutputWithUserChoice(output);
}

// ❌ prompt 里写死具体用户问题
// "当用户说「我想做一个 AI 功能」时，立即调用 AskUserQuestion…"
```

```typescript
// ✅ 通用工具：模型根据任意 tool result 自行决定是否调用
export const askUserQuestionToolDefinition = {
  description: "Use when the user must choose among 2–4 concrete options…",
};

// ✅ harness 只实现交互契约，不解析业务语义
const result = await registry.execute(toolCall);
// 结果原样回给模型；是否 AskUserQuestion 由模型在下一轮 tool call 决定
```

## 技能目录完整性

**System prompt 必须完整列出模型可调用的 Skill 目录**，格式与 Claude Code 一致：

```
<system-reminder>
The following skills are available for use with the Skill tool:

- deep-research: ...
- init: ...
[默认段：bundled + system registry，按 name 排序]

- code-review: ...
[用户段：已安装且 enabled 的用户 skill，按 name 排序]
</system-reminder>
```

### 契约

| 段 | 来源 |
|----|------|
| **默认段** | monorepo `skills/`（bundled）+ `SYSTEM_SKILL_REGISTRY` 中非 `slashOnly` 项（可 `Skill()`） |
| **用户段** | 设置页安装且 `enabled !== false` 的**全部** skill（`installed-skills.json` + `~/.kako/skills/` / 项目 `.kako/skills/`） |

Slash-only（`/plan` `/auto` `/manual`）只出现在 CLI `/` 菜单，**不得**进入 Skill tool 目录。

注入格式与 Claude Code 一致：

```
The following skills are available for use with the Skill tool:

- deep-research: …
- init: …
- code-review: …   # 用户导入 skill，同格式连续列出
```

`Skill()` 分发：先判断是否默认 skill（`workflows` / `init` / `dynamic-workflow` 等）走处理函数；否则从 skill 目录加载 `SKILL.md`。

注入位置：`buildMessages` 在 Environment、Agent catalog 之后追加（不在 `agents/prompts/main.md` 硬编码）。

### 禁止

- 用 `agents/main.yaml` 的 `skills:` 白名单裁剪目录（`filterSkillsForAgent` 不得接入 `buildMessages`）
- 用 harness patch 在运行时隐藏已发现 skill
- 工具失败后在 assistant 文本中谎报成功（改 `agents/prompts/main.md`）

### 测试

`partitionSkillsForCatalog` 默认段 + 用户段条目数应等于 `discoverSkillsForAgent` 去重后的全集；缺 bundled system skill 文件时应 warning，不得静默跳过。

## Claude Code 内置 Tool 完整性

主 agent 每轮 LLM 请求的 **`tools` 参数**（非 `tool_calls`）必须包含 `CLAUDE_CODE_BUILTIN_TOOL_NAMES` 中的全部 built-in（28 个，含 Agent）+ 已连接 MCP tool。描述文案以 `packages/core/src/tools/claude-tool-text.ts` 为 canonical 源，经 `adaptClaudeCodeToolText` 做 Kako 路径/product 替换，**不得删段、不得缩写**。

缺失 built-in 视为红线；`registry.test.ts` 契约测试覆盖。

## 相关文档

- Agent 与 AskUserQuestion 边界：`agents/prompts/main.md`
- 工具需求：`docs/requirements/04-tools.md`
- Agent 需求：`docs/requirements/03-agent.md`
