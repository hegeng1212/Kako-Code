---
name: core-dev
description: Use when developing in packages/core — AgentRuntime, runAgentLoop, buildMessages, ToolRegistry, builtin tools, memory, workflows, background tasks, sessions, or MCP registration. For security-only changes prefer security-dev; still use this skill for session-scoped registry boundaries.
---

# Core harness (`packages/core`)

Docs-first: update this skill and/or `packages/core/AGENTS.md` before changing harness contracts. Root constraints: `AGENTS.md`, `docs/dev/engineering-principles.md`.

## Architecture (current)

| Piece | Path |
|-------|------|
| Facade | `src/agent/runtime.ts` — `AgentRuntime` |
| Turn loop | `src/agent/loop.ts` — `runAgentLoop`, streaming, Skill pivot, abort/rollback |
| Context | `src/agent/context.ts` — `buildMessages`, system prompt base, catalogs, memory sections |
| Agent YAML load | `src/agent/loader.ts` |
| Tools | `src/tools/registry.ts`, `src/tools/builtin/registry.ts` |
| Parallel tools | `src/agent/tool-parallel.ts` (+ registry `confirmChain` for serial confirms) |
| Sessions | `src/session/manager.ts` |
| Memory | `src/memory/*` |
| Workflows | `src/workflows/runner.ts`, `control.ts`, … |
| Public API | `src/index.ts` |

Typical turn: `AgentRuntime` prepares messages + **new** `ToolRegistry` → `runAgentLoop` streams → `registry.execute` → tool results back into messages.

## Session-scoped state (common footgun)

`createToolRegistry` constructs a **new** `ToolRegistry` every turn. Anything that must survive turns belongs on `AgentRuntime` session maps, for example:

- `sessionToolAllowsBySession` (`SessionToolAllows` shared into each registry)
- `sessionPermissionModeBySession`
- `sessionPlanFilePathBySession`
- `currentTurnModelBySession`

Do not store cross-turn approvals only on a registry instance.

## Fix at the right layer

| Problem | Change |
|---------|--------|
| When the model calls tools / what it says | `agents/prompts/`, agent YAML |
| Tool availability / parameters | Tool `description` + schema; builtin copy via `claude-tool-text.ts` + adapt |
| Esc / selection / Ctrl+C | CLI state machine + loop lifecycle |
| Parse / protocol bugs | Owning module |
| Architecture gaps | Spec/plan → proper implementation |

**Forbidden:** runtime semantic guards, harness-forced tool calls, scenario keyword enumeration. See engineering principles.

## Where new features go

| Feature | Landing |
|---------|---------|
| New builtin tool | `tools/builtin/` + register in `builtin/registry.ts`; text via `claude-tool-text.ts` |
| Turn / streaming behavior | `loop.ts` / `runtime.ts` |
| Injected context | `context.ts`, memory modules |
| Subagents | `tools/builtin/agent-tool.ts`, `subagent-catalog.ts`, child registry in runtime |
| Background work | `background/*` |
| Slash commands | `session/slash.ts` + runtime/CLI wiring |
| MCP tools | `mcp/*` + `mcpManager.registerTo` in `createToolRegistry` |

## Skill catalog vs YAML `skills:`

- Catalog in the system prompt: `partitionSkillsForCatalog` (defaults + user-enabled).
- `filterSkillsForAgent` exists for whitelist filtering but **must not** be wired into `buildMessages` catalog injection.
- Agent YAML `skills:` is not the catalog source of truth; do not use it to hide installed skills from the model.

## Verify

```bash
pnpm --filter @kako/core test
pnpm --filter @kako/core build
```

If CLI is affected: also rebuild `@kako/cli`.
