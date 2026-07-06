# Skill 系统 PRD

## 概述

Kako Skill 遵循 [Agent Skills 开放规范](https://agentskills.io/specification)，与 Cursor / Superpowers / SkillHub 生态兼容。

## 目录结构

```
my-skill/
├── SKILL.md          # frontmatter(name, description) + 指令正文
├── scripts/          # 可执行脚本
├── references/       # 按需加载的参考文档
└── assets/           # 模板、静态资源
```

## SKILL.md 格式

```markdown
---
name: brainstorming
description: Use before any creative work — explores intent and design
---

# Brainstorming

When starting creative work, invoke this skill first...

## Steps
1. ...
```

## 生命周期

```mermaid
flowchart LR
  Discover[发现 metadata] --> Match[任务匹配]
  Match --> Activate[读取完整 SKILL.md]
  Activate --> Execute[按指令执行]
  Execute --> Log[记录日志]
```

| 阶段 | 说明 | Token 成本 |
|------|------|-----------|
| 发现 | 启动时加载 name + description | ~100 tokens/skill |
| 激活 | 匹配任务后读取完整正文 | 完整 SKILL.md |
| 执行 | 按指令调用 scripts / 工具 | 视任务而定 |

## 来源与优先级

| 来源 | 路径 | 优先级 |
|------|------|--------|
| 项目 | `.kako/skills/` | 最高 |
| 全局 | `~/.kako/skills/` | 中 |
| 内置 | `skills/`（monorepo） | 低 |
| Registry | `kako skill install <url>` | 安装到全局 |

同名 Skill 高优先级覆盖低优先级。

## CLI 命令

```bash
kako skill list                    # 列出已安装 Skill
kako skill install <git-url>       # 从 Git 安装
kako skill install <registry-id>   # 从 registry 安装（Phase 3）
kako skill remove <name>           # 卸载
```

## 斜杠命令

用户可在对话中输入 `/commit`、`/review` 等快捷入口，映射到对应 Skill：

```yaml
# .kako/config/skills.yaml
slashCommands:
  commit: commit-helper
  review: code-review
```

## Agent 绑定

Agent 定义中通过 `skills: [brainstorming, tdd]` 限制可用 Skill 集合。未绑定的 Skill 对 Agent 不可见。

## 日志

记录到 `~/.kako/logs/skills/{date}.jsonl`：

```json
{
  "timestamp": "2026-07-03T10:00:00Z",
  "skillName": "brainstorming",
  "reason": "User starting new feature",
  "durationMs": 4500,
  "steps": ["Read SKILL.md", "Ask clarifying questions"]
}
```

## Phase 划分

| 能力 | Phase |
|------|-------|
| 发现 + 激活（本地） | 2 |
| `kako skill install` | 2 |
| 斜杠命令 | 2 |
| Registry 生态 | 3 |

## 待确认项

- [ ] 默认内置 Skill 列表
- [ ] Registry 协议设计
- [ ] Skill 脚本执行沙箱策略
