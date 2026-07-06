# 记忆系统 PRD

## 概述

Kako 采用**文件优先**的多层记忆架构。首版以人类可读的 Markdown/JSON 文件存储，便于调试与 Git 友好。参考 mem0（事实合并）、Letta/MemGPT（分页记忆）、Zep/Graphiti（时间有效性），但实现保持简洁。

## 记忆分层

| 层级 | 标识 | 存储路径 | 内容 | 更新策略 |
|------|------|----------|------|----------|
| L0 | Raw Transcript | `memory/sessions/{id}/transcript.jsonl` | 完整消息流 | 实时追加 |
| L1 | Session Summary | `memory/sessions/{id}/summary.md` | 单会话压缩摘要 | 会话结束 / 超 token 阈值 |
| L2 | Rolling Summary | `memory/summaries/rolling/{date}.md` | 跨会话周期性总结 | 定时任务（daily/weekly） |
| L3 | Long-term Facts | `memory/facts/*.md` + `facts.index.json` | 原子事实 | mem0 式 ADD/UPDATE/DELETE/NOOP |
| L4 | User Profile | `memory/profile/user.md` | 偏好、角色、沟通风格 | 从 L3 聚合 + 用户编辑 |
| L5 | Episodic Archive | `memory/episodes/{id}.md` | 重要事件叙事 | 高 salience 事件触发 |

## 目录结构（`~/.kako/memory/`）

```
memory/
├── sessions/
│   └── {sessionId}/
│       ├── transcript.jsonl
│       └── summary.md
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

## 核心 API

```typescript
memory.append(message)           // L0 追加
memory.recall(query, layers[])   // 跨层检索
memory.consolidate(sessionId)    // L0 → L1 压缩
memory.extractFacts(transcript)  // → ADD/UPDATE/DELETE/NOOP
```

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

## 检索策略

| Phase | 方式 |
|-------|------|
| 1 | 关键词匹配 + 最近会话优先 |
| 2 | SQLite FTS5 全文索引 |
| 3 | 可选 sqlite-vec 向量检索 |

## Consolidation 策略

### L0 → L1（会话内）

- 触发：会话结束，或 transcript token 超过阈值（默认 80% context window）
- 方式：调用 LLM 生成结构化摘要，写入 `summary.md`

### L1 → L2（跨会话）

- 触发：每日定时任务或 `kako memory consolidate`
- 方式：合并当日所有 L1 摘要为 rolling summary

### L2 → L3（事实提取）

- 触发：consolidate 后或显式 `memory.extractFacts()`
- 方式：mem0 式决策 — ADD 新事实、UPDATE 已有、DELETE 过时、NOOP 无变化

## Phase 划分

| 能力 | Phase |
|------|-------|
| L0 transcript 追加 | 1 |
| L1 session summary | 1 |
| L2 rolling summary | 2 |
| L3 事实提取与合并 | 2 |
| L4 用户画像 | 2 |
| L5 情景归档 | 3 |
| FTS / 向量检索 | 2–3 |
| 对抗 / 遗忘 / 梦境 | 3 |

## 高级机制（Phase 3）

| 机制 | 说明 |
|------|------|
| 对抗（Antagonism） | Critic 子 Agent 对新增事实做矛盾检测 |
| 遗忘（Forgetting） | 基于 salience、访问频率、时间衰减 |
| 梦境（Dreaming） | 离线批处理重组、关联、压缩记忆 |

## 待确认项

- [ ] L0 → L1 的 token 阈值默认值
- [ ] L3 事实提取使用的模型与 prompt
- [ ] 是否首版引入 sqlite 索引层
