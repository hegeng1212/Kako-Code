# 可观测性 PRD

## 概述

Kako 提供全面的可观测性：工具/Skill 调用日志、Agent 运行树、Token 用量和会话索引。数据以 JSONL 文件存储，桌面 App 提供查询界面。

## 数据类型

| 数据 | 存储路径 | 格式 |
|------|----------|------|
| Tool 调用日志 | `logs/tools/{date}.jsonl` | JSONL |
| Skill 调用日志 | `logs/skills/{date}.jsonl` | JSONL |
| Agent 运行树 | `logs/runs/{runId}.json` | JSON |
| LLM 调用日志 | `logs/llm/{date}.jsonl` | JSONL |
| 会话索引 | `index/sessions.db` | SQLite |

## Tool 调用日志

```json
{
  "timestamp": "2026-07-03T10:00:00.123Z",
  "sessionId": "sess-abc",
  "agentId": "agent-main",
  "toolUseId": "tu-001",
  "toolName": "Read",
  "input": { "path": "src/index.ts" },
  "output": "file contents...",
  "status": "success",
  "durationMs": 12
}
```

## Skill 调用日志

```json
{
  "timestamp": "2026-07-03T10:05:00.456Z",
  "sessionId": "sess-abc",
  "agentId": "agent-main",
  "skillName": "brainstorming",
  "reason": "User starting new feature",
  "durationMs": 4500,
  "steps": ["Read SKILL.md", "Ask clarifying questions", "Present design options"]
}
```

## Agent 运行树

```json
{
  "runId": "run-001",
  "sessionId": "sess-abc",
  "root": {
    "runId": "run-001",
    "agentId": "agent-main",
    "agentName": "main",
    "status": "running",
    "startedAt": "2026-07-03T10:00:00Z",
    "children": [
      {
        "runId": "run-002",
        "agentId": "agent-explore-1",
        "agentName": "explore",
        "parentToolUseId": "tu-005",
        "status": "completed",
        "startedAt": "2026-07-03T10:01:00Z",
        "endedAt": "2026-07-03T10:01:30Z",
        "tokenUsage": { "inputTokens": 5000, "outputTokens": 800, "totalTokens": 5800 },
        "children": []
      }
    ]
  }
}
```

## LLM 调用日志

```json
{
  "timestamp": "2026-07-03T10:00:05Z",
  "sessionId": "sess-abc",
  "agentId": "agent-main",
  "provider": "anthropic",
  "model": "claude-sonnet-4",
  "inputTokens": 3200,
  "outputTokens": 450,
  "durationMs": 2300,
  "finishReason": "stop"
}
```

## 事件总线

Harness 内部通过事件总线发布 `ObservabilityEvent`：

```typescript
interface ObservabilityEvent {
  type: "tool" | "skill" | "llm" | "agent" | "session" | "error";
  timestamp: string;
  sessionId: SessionId;
  payload: Record<string, unknown>;
}
```

CLI 和 App 可订阅事件流实现实时更新。

## App 展示

### 工具日志页

| 列 | 说明 |
|----|------|
| 时间 | timestamp |
| Tool | toolName |
| Agent | agentName |
| 状态 | success / error / denied |
| 耗时 | durationMs |
| 详情 | 展开 input/output |

支持按日期、tool、agent、status 筛选。

### 运行树页

- 树状展示主/子 Agent 关系
- 节点颜色标识状态（running / completed / failed）
- 点击节点查看 summary 和 token usage

### 成本仪表盘（Phase 3）

- 按日/周/月汇总 token 用量
- per-model 成本估算
- 会话级成本排名

## 日志轮转

- JSONL 按日期分文件
- 默认保留 90 天
- `kako logs clean --before 30d` 清理旧日志

## Phase 划分

| 能力 | Phase |
|------|-------|
| Tool 调用日志 | 1 |
| LLM 调用日志 | 1 |
| Skill 调用日志 | 2 |
| Agent 运行树 | 2 |
| 会话 SQLite 索引 | 2 |
| App 日志页 + 运行树 | 2 |
| 成本仪表盘 | 3 |

## 待确认项

- [ ] 日志保留策略默认值
- [ ] 是否支持导出为 OpenTelemetry 格式
- [ ] 敏感数据脱敏规则（API Key、文件内容）
