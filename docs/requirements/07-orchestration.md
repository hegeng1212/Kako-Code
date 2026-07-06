# 工作流与编排 PRD

## 概述

Orchestrator 负责 Agent 之间的任务编排，支持串行、并行、递归和（Phase 3）Workflow DSL。

## 编排模式

### 串行

Task A → Task B → Task C，前一步输出作为后一步输入。

```typescript
orchestrator.serial([
  { agent: "explore", prompt: "Find auth module" },
  { agent: "plan", prompt: "Design refactor plan" },
  { agent: "main", prompt: "Implement the plan" },
]);
```

### 并行

多个子 Agent 同时执行，结果汇总：

```typescript
const results = await orchestrator.parallel([
  { agent: "explore", prompt: "Search for API routes" },
  { agent: "explore", prompt: "Search for database models" },
]);
```

### 递归

Agent 通过 `Agent` 工具 spawn 子 Agent，形成树状结构：

```
MainAgent
├── SubAgent_A (explore)
│   └── SubAgent_C (general-purpose)
└── SubAgent_B (plan)
```

每个节点通过 `parent_tool_use_id` 关联。

## 结果聚合

| 模式 | 聚合方式 |
|------|----------|
| 并行探索 | 合并摘要，去重文件引用 |
| 串行管道 | 前步 summary 注入后步 prompt |
| 递归 | 子 Agent 仅返回 summary 给父 Agent |

## Background Agent

长时间任务可后台运行：

```json
{
  "run_in_background": true
}
```

- 主会话继续交互
- 后台 Agent 完成后通知主会话
- 状态查询：`kako agent status <runId>`

## 检查点（Checkpoint）

长流程保存 state，支持暂停/恢复：

```json
// ~/.kako/checkpoints/{runId}.json
{
  "runId": "...",
  "agentTree": { ... },
  "completedSteps": ["step-1", "step-2"],
  "pendingSteps": ["step-3"],
  "context": { ... }
}
```

## Workflow DSL（Phase 3）

YAML 定义复杂流程：

```yaml
name: feature-development
steps:
  - id: explore
    agent: explore
    prompt: "Understand the codebase around {{feature}}"
  - id: plan
    agent: plan
    prompt: "Design implementation for {{feature}}"
    dependsOn: [explore]
  - id: implement
    agent: main
    prompt: "Implement according to plan"
    dependsOn: [plan]
  - id: review
    parallel:
      - agent: explore
        prompt: "Review code changes"
      - agent: general-purpose
        prompt: "Run tests"
    dependsOn: [implement]
```

## Git Worktree 隔离（Phase 3）

子 Agent 可在独立 git worktree 中执行，避免文件冲突：

```json
{
  "subagent_type": "general-purpose",
  "isolation": "worktree"
}
```

## Phase 划分

| 能力 | Phase |
|------|-------|
| 串行 / 并行（via Agent tool） | 2 |
| Background Agent | 2 |
| Checkpoint | 3 |
| Workflow DSL | 3 |
| Worktree 隔离 | 3 |

## 待确认项

- [ ] 并行子 Agent 数量上限
- [ ] Background Agent 通知机制（轮询 vs 事件）
- [ ] Checkpoint 存储格式
