# 目录结构

## Monorepo 布局

```
kako/
├── docs/
│   ├── requirements/          # 功能需求 PRD
│   ├── architecture/          # 架构设计
│   ├── adr/                   # Architecture Decision Records
│   └── dev/                   # 开发指南
├── packages/
│   ├── shared/                # 共享类型与协议
│   ├── core/                  # Harness 核心
│   │   ├── agent/
│   │   ├── llm/
│   │   ├── memory/
│   │   ├── tools/
│   │   ├── skills/
│   │   ├── orchestrator/
│   │   ├── hooks/
│   │   └── observability/
│   └── cli/                   # CLI 入口
├── apps/
│   └── desktop/               # Tauri 2 App
│       ├── src/               # React UI
│       └── src-tauri/         # Rust 桥接
├── agents/                    # 内置 Agent 定义
├── skills/                    # 内置/示例 Skills
├── package.json
├── pnpm-workspace.yaml
└── turbo.json
```

## 用户数据目录（`~/.kako/`）

```
~/.kako/
├── config/
│   ├── providers.yaml         # LLM 供应商配置
│   ├── agents.yaml            # Agent 覆盖配置
│   └── skills.yaml            # 斜杠命令映射
├── memory/
│   ├── sessions/{id}/
│   │   ├── transcript.jsonl
│   │   └── summary.md
│   ├── summaries/rolling/
│   ├── facts/
│   ├── profile/
│   └── episodes/
├── skills/                    # 全局安装的 Skill
├── logs/
│   ├── tools/{date}.jsonl
│   ├── skills/{date}.jsonl
│   ├── llm/{date}.jsonl
│   └── runs/{runId}.json
├── index/
│   └── sessions.db            # 会话索引（SQLite）
└── checkpoints/               # 长流程检查点
```

## 项目目录（`.kako/`）

```
my-project/
├── KAKO.md                    # 项目上下文（自动注入）
├── .kako/
│   ├── project.md             # 项目上下文（优先级更高）
│   ├── skills/                # 项目级 Skill
│   └── config.yaml            # 项目级配置覆盖
├── src/
└── ...
```

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

## Skill 目录示例

```
skills/
└── brainstorming/
    ├── SKILL.md
    ├── scripts/
    ├── references/
    └── assets/
```

## 包导出结构

### `@kako/shared`

```
packages/shared/src/
├── index.ts
├── agent.ts
├── tool.ts
├── skill.ts
├── memory.ts
├── llm.ts
├── session.ts
├── hook.ts
└── observability.ts
```

### `@kako/core`（Phase 1+ 逐步实现）

```
packages/core/src/
├── index.ts
├── agent/
│   ├── runtime.ts
│   └── loader.ts
├── llm/
│   ├── router.ts
│   └── providers/
├── memory/
│   ├── store.ts
│   └── consolidate.ts
├── tools/
│   ├── registry.ts
│   └── builtin/
├── skills/
│   ├── registry.ts
│   └── loader.ts
├── orchestrator/
│   └── index.ts
├── hooks/
│   └── engine.ts
└── observability/
    └── logger.ts
```
