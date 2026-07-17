---
name: prompt-agents
description: Use when editing agents/*.yaml, agents/prompts/*.md, or changing how buildMessages / skill catalog injection presents instructions to the model.
---

# Agent prompts & YAML

Docs-first: if model-facing contracts change, update this skill and the prompts/YAML in the same change set (docs before or with code that loads them).

## Map (current)

| Artifact | Path |
|----------|------|
| Agent definitions | `agents/main.yaml`, `explore.yaml`, `plan.yaml`, `general-purpose.yaml` |
| System prompts | `agents/prompts/main.md`, `explore.md`, `plan.md`, `plan-workflow.md`, `general-purpose.md` |
| Classifier prompts | `security-action-classifier.md`, `session-state-classifier.md` (not the main chat agent) |
| Load | `packages/core/src/agent/loader.ts` |
| Assemble into LLM request | `packages/core/src/agent/context.ts` (`buildMessages`, `buildSystemPromptBase`) |
| Builtin tool copy | `packages/core/src/tools/claude-tool-text.ts` |

Environment, agent catalog, memory, and **Skill catalog** are appended in `buildMessages` — do not hardcode the catalog into `main.md`.

## Division of responsibility

| Layer | Owns |
|-------|------|
| Prompt | Rules, when to use/avoid tools, interaction shape — **no** vertical user-phrase example books as logic |
| Tool description / schema | Parameters and availability boundaries |
| Harness | Lifecycle / UX contracts, not guessed intent |

## Skill catalog completeness

- Defaults (bundled + invocable system) + user-enabled installs must appear in the Skill catalog.
- Do **not** trim the catalog with agent YAML `skills:` via `filterSkillsForAgent` in `buildMessages`.
- YAML `skills:` may remain on definitions for schema/history; it is **not** the catalog source of truth. Catalog = `partitionSkillsForCatalog`.
- Slash-only system entries (`/plan`, `/auto`, `/manual`) stay out of the Skill tool catalog.

## Builtin tools completeness

The main agent’s per-request `tools` list must include the full Claude-Code-compatible builtin set (+ connected MCP). Missing builtins are a red line; see registry contract tests and engineering principles.

## Checklist when editing prompts

1. Does this belong in prompt vs tool description vs CLI/loop?
2. Any new keyword/scenario samples that act as branches? Remove; write rules instead.
3. Conflicts with `claude-tool-text` or existing tool schemas?
4. Run related tests (`explore-prompt`, system-skills / catalog tests) when touching injection.

## Product vs dev skills

- `skills/`, `~/.kako/skills`, project `.kako/skills` → **runtime** Skill tool content.
- `.agents/skills/` → **contributor** how-tos. Never publish the latter into the runtime catalog.
