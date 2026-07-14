# 记忆系统 PRD

## 概述

Kako 采用**文件优先**的多层记忆架构。首版以人类可读的 Markdown/JSON 文件存储，便于调试与 Git 友好。参考 mem0（事实合并）、Letta/MemGPT（分页记忆）、Zep/Graphiti（时间有效性），以及 OpenClaw / Claude Compact / Hermes 的分级压缩与按需检索。

**共识契约：**

1. **压缩 ≠ 记忆**：compact 管「本会话窗口」；记忆层管「跨回合/跨会话可取回」。
2. **Write-before-compact**：压缩前必须把耐久事实落到文件（precompact flush）。
3. **检索按需、注入有界**：bootstrap 只注入小集合（L4 + 有 cap 的 L3 + pins）；历史走工具，禁止「grep 全结果 RAG dump」。
4. **累积摘要**：每次 compact 留下可叠加的 Historical Context，避免多次 compact 后决策链断裂。

触发 compact / flush **只看 token/预算契约**，不用语义启发式判断「该不该记」。

## 记忆分层

| 层级 | 标识 | 存储路径 | 内容 | 注入策略 | 更新策略 |
|------|------|----------|------|----------|----------|
| L0 | Raw Transcript | `memory/sessions/{id}/transcript.jsonl` | 完整消息流（含 `compact_boundary` 元事件） | **不整段注入**；仅近期 tail 进 messages | 实时 append；compact 不改写历史行 |
| L1 | Session Summary | `memory/sessions/{id}/summary.md` | 累积章节摘要（Goal / Decisions / Files / Open / Next / Historical Context） | compact 后 / resume 注入「Previous Session Summary」 | flush + structured consolidate |
| DetailLog | UI 进度 | `SessionMeta.agentState.detail` | Agents 列表短周期预览 | **不进入**模型消息组装 | classifier / BG / slash |
| Pins | Checkpoint | `memory/sessions/{id}/pins.json` | 路径、数字、未完成 TODO（verbatim） | 每轮有界 reinject | 模型/flush 写入；count+bytes cap |
| L2 | Rolling Summary | `memory/summaries/rolling/{date}.md` | 跨会话日汇总 | 不默认注入；search 可命中 | 日终 Curator 或 `kako memory consolidate` |
| L3 | Long-term Facts | `memory/facts/*.md` + `facts.index.json` | 原子事实 | bootstrap top-K / 摘录（token cap） | ADD/UPDATE/DELETE/NOOP |
| L4 | User Profile | `memory/profile/user.md` | 偏好、角色、沟通风格 | **每会话 bootstrap** | 用户编辑 + 从 L3 聚合 |
| L5 | Episodic Archive | `memory/episodes/{id}.md` | 高 salience 叙事 | 仅 recall | Curator 晋升 |

编码项目约束继续走 workspace `KAKO.md`（已有 harness），**不**把整仓文件塞进 memory。

## 目录结构（`~/.kako/memory/`）

```
memory/
├── sessions/
│   └── {sessionId}/
│       ├── transcript.jsonl
│       ├── summary.md          # L1 + frontmatter (updatedAt, compactGeneration)
│       ├── pins.json           # MemoryPin[]
│       └── compaction.jsonl    # CompactBoundary 事件（可选；亦可 append 到 transcript）
├── summaries/
│   └── rolling/
│       └── 2026-07-03.md
├── facts/
│   ├── facts.index.json
│   └── {factId}.md
├── profile/
│   └── user.md
└── episodes/
    └── {episodeId}.md
```

索引（文件仍为 SoT）：`~/.kako/index/memory-fts.db`（Phase 2 FTS5）。

## 核心 API

```typescript
memory.append(message)                    // L0 追加
memory.recall(options)                    // 遗留跨层检索（有界）
memory.search(options) → SearchHit[]      // FTS；snippet ≤700 chars，默认 ≤8
memory.get(options) → string              // 按 path + line range 取正文
memory.consolidate(sessionId)             // L0 → L1 结构化累积摘要
memory.extractFacts(transcript)           // → ADD/UPDATE/DELETE/NOOP
memory.loadPins() / savePins()            // 有界 pins
runCompactionCascade(...)                 // Tier A → B → C + precompact flush
```

类型见 `@kako/shared`：`CompactBoundary`、`MemoryPin`、`SearchHit`、`L1SummaryFrontmatter`、`MemoryInjectCaps`、`DEFAULT_MEMORY_INJECT_CAPS`、`SessionMemoryCompact`、`MemoryFlushPayload`、`MemoryTelemetry`。

## 配置与周期元数据（Memory Hardening）

**用户设置**（`~/.kako/config/memory.json`）：`autoRecall`（默认 `true`）、可选 `injectCaps` 覆盖。缺文件 ≡ 默认 caps。

**周期元数据**（`SessionMeta.memoryCompact`）：`generation` 与 L1 `compactGeneration` 对齐；每周期至多一次 structured flush（`lastFlushAt`）；`tokenEstimateRatio` EMA 校准预算；`lastTier` / `lastFailure` 供 UI 与降级。

**表面不变量**：memory 块只追加在 skills 之后；不裁剪默认+用户 skill catalog；不替换顶层 `resolveAllToolNames`；flush LLM 不改动主 turn 工具注册表。

## Compaction Cascade

在 agent turn 组消息前跑预算 + 必要时写边界：

### Tier A — Tool / file budget（免费，每轮）

- 对**旧** tool 消息做内容折叠：保留 `toolName`、路径提示、exit、末尾 N 行；超过阈值标记 truncated。
- 同路径多次 Read：只保留最近一次全文级结果，更早的改为 stub。
- L0 文件保留全文；折叠只作用于 **transcript 视图**（传给 `buildMessages` 的投影）。

### Tier B — Session-memory compact（中成本）

- 当估计 tokens ≥ `contextWindow - reserve` 的 soft ratio：若 L1 已有足够新的 rolling section，用 **L1 + pins + 最近 K 轮** 替换 messages 中的旧段（无二次 LLM）。
- L0 **只追加** `compact_boundary`（或 `compaction.jsonl`）。

### Tier C — Full LLM consolidate（高成本）

- L1 过期/缺失或 Tier B 仍超阈值：LLM 按固定结构写累积摘要：
  - Goal / Decisions+Why / Files touched / Open questions / Next / Historical Context
- 写盘后注入；最近 tail + pins 保留 verbatim。

### PreCompact Flush（必做）

- Soft threshold 触发：把耐久点写入 L1/L3/daily（每 compaction 周期一次）。
- Sandbox 只读则跳过并记 telemetry。
- **先 flush 再 compact**，避免「先压再想记已经晚了」。

## 检索契约（消灭 RAG 填充）

错误模式：`recall(query)` → 把所有 L0 `includes` 命中拼进 system。

正确模式：

1. **Index（Phase 2）**：SQLite FTS5 覆盖 L0 用户/助手文本、L1、L2、L3（文件仍为 SoT；索引可重建）。向量为 Phase 3 可选。
2. **工具而非暗注**：
   - `memory_search`：有界列表（默认 ≤8）：`{layer, path, score, snippet≤700chars, lineRange}`。
   - `memory_get`：按 path + line/range 取正文。
3. **Auto-recall（可选、默认开但强约束）**：每用户消息可跑一次 search，但 **仅注入 ≤N snippets / ≤M tokens**，标记为 *untrusted retrieved context*；**禁止** L0 全文 dump。
4. **Agents 列表**：跨会话浏览用 L1 标题 + `agentState.detail`；点开再 load L0。DetailLog **不进入**模型 RAG。

## 会话上下文组装顺序（每轮）

1. System：agent prompt + env + security + skills  
2. Bootstrap：**L4**（全量小文件）+ **L3 摘录**（cap）+ **Pins**  
3. Warm：**L1**（若存在 / 刚 compact）  
4. Retrieved block（若 auto-recall）：有界 snippets  
5. Messages：**compact 后的 transcript 视图**（非裸全量 L0）  
6. 当前 user turn  

Agents UI 的 DetailLog **不进入**上述链路。

## L3 事实格式

每个事实文件（`{factId}.md`）：

```markdown
---
id: fact-001
confidence: 0.9
source: session-abc123
valid_from: 2026-07-01
valid_to: null
created_at: 2026-07-01T10:00:00Z
updated_at: 2026-07-03T08:00:00Z
---

用户偏好使用 TypeScript 和 pnpm monorepo。
```

`facts.index.json` 维护 id → 文件路径、关键词索引。

## Inject caps 默认值

见 `DEFAULT_MEMORY_INJECT_CAPS`：

| 项 | 默认 |
|----|------|
| pinsMaxCount | 12 |
| pinsMaxBytes | 4096 |
| l3FactsMaxTokens | 800 |
| autoRecallMaxSnippets | 4 |
| autoRecallMaxTokens | 600 |
| searchHitSnippetChars | 700 |
| searchDefaultLimit | 8 |
| toolResultMaxChars | 4000 |
| toolResultKeepTailLines | 40 |
| compactReserveTokens | 8192 |
| softCompactRatio | 0.8 |
| recentTailTurns | 6 |

## Phase 划分

| 能力 | Phase |
|------|-------|
| 契约类型、PRD、inject caps | 0 |
| L0 append、Tier A tool budget、真 L1 累积 consolidate、flush、pins | 1 |
| FTS、memory_search/get、L2/L3 extract、有界 auto-recall | 2 |
| Curator、遗忘、L5、可选向量 | 3 |
| Agents DetailLog ↔ L1 里程碑对齐（UI 不进 RAG） | 持续 |

## 高级机制（Phase 3）

| 机制 | 说明 |
|------|------|
| 对抗（Antagonism） | Critic 对新增事实做矛盾检测 |
| 遗忘（Forgetting） | 基于 salience、访问频率、时间衰减 |
| 梦境（Dreaming） | 离线批处理重组、关联、压缩记忆 |
| L5 晋升 | 高 salience 叙事从 L1/L2 晋升 |

## 工程红线

- 不在 harness 用正则判断「该不该记 / 是不是闲聊」；flush/compact 只看 token/预算。
- 不把「用户说过 X」写进 prompt 分支；用工具 description + 记忆文件契约。
- 测试用中性数据（Option A/B、假路径）。
- Compact 失败：保留 pins + 上次 L1，提示用户。

## 成功标准

1. 超阈值自动 A→B→C，模型仍见 pins + 累积 L1 + 近尾。
2. 历史会话查询：FTS 命中 L1/标题/snippet，列表可定位 session。
3. 跨会话：`memory_search` 返回有界 snippet，细节再 `memory_get`。
4. 大文件/超长：旧 tool 折叠，context 近线性于活跃工作集。
5. 无 RAG 填充：auto-recall 与 search 有硬 cap。
6. Agents：DetailLog 与 L1 解耦，可共用 classifier 里程碑。
