# ADR-002: 文件优先记忆策略

## 状态

已接受

## 背景

Kako 需要多层记忆系统（L0–L5），支持跨会话持久化、事实提取和检索。需要选择存储后端。

## 决策

采用**文件优先**策略：记忆以 Markdown/JSON 文件存储在 `~/.kako/memory/`，索引层可选 SQLite。

### 存储格式

| 层级 | 格式 | 路径 |
|------|------|------|
| L0 transcript | JSONL | `sessions/{id}/transcript.jsonl` |
| L1 summary | Markdown | `sessions/{id}/summary.md` |
| L2 rolling | Markdown | `summaries/rolling/{date}.md` |
| L3 facts | Markdown + JSON index | `facts/{id}.md` + `facts.index.json` |
| L4 profile | Markdown | `profile/user.md` |
| L5 episodes | Markdown | `episodes/{id}.md` |

### 索引层

Phase 2 引入 SQLite（FTS5）作为可选索引，文件仍为 source of truth。

## 理由

| 选项 | 优点 | 缺点 | 决定 |
|------|------|------|------|
| 文件（Markdown/JSON） | 人类可读、Git 友好、易调试 | 检索性能有限 | ✅ 主存储 |
| SQLite | 快速检索、FTS | 不透明、难手动编辑 | ✅ 索引层 |
| 向量数据库 | 语义检索强 | 复杂、本地部署难 | Phase 3 可选 |
| 全 SQLite | 简单 | 违背可读性原则 | ❌ |

### 为什么文件优先

1. **可调试**：开发者可直接查看/编辑记忆文件
2. **Git 友好**：项目级记忆可纳入版本控制
3. **零依赖**：首版无需数据库安装
4. **透明**：用户完全掌控数据
5. **渐进**：SQLite 索引作为可选增强，不替代文件

### 事实合并策略

参考 mem0 的 ADD/UPDATE/DELETE/NOOP 模式：

- 新事实 → ADD
- 矛盾事实 → UPDATE（保留历史版本）
- 过时事实 → DELETE 或设置 valid_to
- 重复事实 → NOOP

## 后果

- 首版检索为关键词匹配，性能可接受（个人助理规模）
- Phase 2 需实现 SQLite FTS 索引同步
- 文件并发写入需加锁（单用户场景影响小）
- 记忆目录可能增长，需日志轮转和遗忘机制（Phase 3）

## 参考

- [mem0](https://github.com/mem0ai/mem0) — 事实合并
- [Letta/MemGPT](https://github.com/letta-ai/letta) — 分页记忆
- [Zep/Graphiti](https://github.com/getzep/zep) — 时间有效性
