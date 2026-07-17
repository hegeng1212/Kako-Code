# @kako/core

Read root [`AGENTS.md`](../../AGENTS.md) first. Load [`.agents/skills/core-dev/SKILL.md`](../../.agents/skills/core-dev/SKILL.md) for harness work; [`.agents/skills/security-dev/SKILL.md`](../../.agents/skills/security-dev/SKILL.md) for security. Docs-first before behavior changes.

## Role

Agent harness: sessions, LLM loop, tools, security, memory, MCP, workflows, background tasks. Public surface: `src/index.ts`.

## Domain map

| Domain | Path |
|--------|------|
| Runtime / turns | `src/agent/runtime.ts` (`AgentRuntime`) |
| Loop / stream | `src/agent/loop.ts` (`runAgentLoop`) |
| Prompt assembly | `src/agent/context.ts` (`buildMessages`) |
| Agent load | `src/agent/loader.ts` |
| Tools | `src/tools/registry.ts`, `src/tools/builtin/` |
| Security | `src/security/` (`runSecurityGate`) |
| Memory | `src/memory/` |
| Session | `src/session/` |
| MCP | `src/mcp/` |
| Workflows | `src/workflows/` |
| Background | `src/background/` |
| Skills (product) | `src/skills/` |
| Config / paths | `src/config/` |

## Hard rules

- **Per-turn registries**: `createToolRegistry` builds a new `ToolRegistry` each turn. Session-scoped state (e.g. tool session-allows) must live on `AgentRuntime` maps such as `sessionToolAllowsBySession`, not only on a single registry instance.
- Fix model/tool issues at prompt / tool schema / loop UX / architecture — no patch heuristics or scenario enumeration (see `docs/dev/engineering-principles.md`).
- Skill **catalog** injection uses `partitionSkillsForCatalog`; do not wire `filterSkillsForAgent` into `buildMessages`.
- Builtin tool text canonical source: `src/tools/claude-tool-text.ts`.
- Consumers should import from `@kako/core` public exports, not deep private paths, when adding CLI/server call sites.
