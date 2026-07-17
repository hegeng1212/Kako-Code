# Repository-level Agent Guide

Reply in the same language as the user.

This is a TypeScript monorepo for agent-assisted **product** development. Keep this root `AGENTS.md` limited to hot-path rules: project map, hard constraints, docs-first workflow, and skill routing.

**Product runtime skills** live under `skills/` (and user install dirs). **Contributor / agent-assisted development skills** live under `.agents/skills/`. Do not mix them; never inject `.agents/skills` into the runtime Skill catalog.

## Docs-first (mandatory for behavior changes)

Before implementing a new feature or changing behavior:

1. **Read** this file → nearest package `AGENTS.md` → matching `.agents/skills/*/SKILL.md`
2. **Update docs** so they describe the target behavior and code landing spots
3. **Then** implement code and tests
4. If implementation drifts, **update docs before merge** — stale docs are a defect

Bug fixes that do **not** change module boundaries or contracts may skip new specs, but still read the relevant skill red lines. If the fix reveals a contract gap, document it.

## Working principles

- Think from first principles: requirements, code facts, verification. If the goal is unclear, ask the user first.
- Code is the source of truth for behavior; these docs must stay aligned with code (write them from the tree, not from memory of other repos).
- Before editing, read the relevant code and the nearest `AGENTS.md` / skill.
- Keep changes focused; no drive-by refactors.
- Do not add co-author or agent identity to commits, PRs, or explanatory text.

## Project map

| Path | Role |
|------|------|
| `packages/shared` | Shared types (no runtime deps) |
| `packages/core` | Harness: agent loop, tools, security, memory, MCP, workflows, sessions |
| `packages/cli` | Terminal UI and `kako` CLI (`ChatLayout`, chat command) |
| `packages/server` | HTTP API for web settings / sessions |
| `apps/web` | Web UI (settings, memory, security) |
| `apps/desktop` | Tauri desktop (Phase 2) |
| `agents/` | Agent YAML + system prompts (model-facing) |
| `skills/` | **Product** Skill tool content (bundled) |
| `.agents/skills/` | **Dev** how-to skills for contributors / coding agents |
| `docs/dev/` | Engineering principles, getting started |
| `docs/superpowers/` | Specs and implementation plans |

Package details: `packages/cli/AGENTS.md`, `packages/core/AGENTS.md`.

## Hard constraints

Full text: [`docs/dev/engineering-principles.md`](docs/dev/engineering-principles.md). Summaries:

1. **No patch fixes** — do not paper over model/tool/UX issues with runtime heuristics (semantic guards, harness-forced tool calls, duplicate system-reminder correction, output-shape rollback retries, one-off special cases).
2. **No enumeration-as-logic** — do not cover business scenarios with keyword/regex/branch tables keyed to user phrasing, domains, or specific tool names. Prefer contracts; let the model choose next steps from tool results.
3. **Skill catalog completeness** — system prompt Skill catalog = default segment (bundled + system) + user-enabled installs. Do not trim via agent YAML `skills:` whitelist in `buildMessages`. `filterSkillsForAgent` must not feed catalog injection.
4. **Claude Code builtin tools completeness** — each LLM request’s `tools` list must include the full builtin set (+ connected MCP). Canonical copy: `packages/core/src/tools/claude-tool-text.ts`.

Fix at the right layer:

| Issue | Where |
|-------|--------|
| Model behavior / when to call tools | `agents/prompts/`, agent YAML |
| Tool boundaries / params | Tool `description` + schema |
| Esc / selection / Ctrl+C | CLI state machine + `runAgentLoop` lifecycle |
| Protocol / parse bugs | The owning module |
| Architecture gaps | Spec/plan → proper implementation |

## Where to update instructions

- Almost every task → this root `AGENTS.md`
- Package-only hard rules → `packages/*/AGENTS.md`
- How-to workflows → `.agents/skills/<name>/SKILL.md`
- Enduring engineering essays → `docs/dev/engineering-principles.md`

## Workflow (short)

- Node `>=22` (see `.nvmrc`; `engine-strict=true` in `.npmrc`), pnpm `10.12.1`
- Lint: `pnpm lint` (oxlint; config `.oxlintrc.json`). Optional autofix: `pnpm lint:fix` — review diffs
- Dev settings UI: `pnpm services:restart` (or `pnpm dev:web`); CLI rebuild/link: `pnpm link:dev`; macOS pkg: `pnpm pack`
- Change shared types → build `@kako/shared` then dependents
- Change CLI → `pnpm --filter @kako/cli build` or `pnpm rebuild:cli` (runtime uses `dist/`)
- Change core → `pnpm --filter @kako/core test` / `build`
- Before claiming done → `.agents/skills/verify/SKILL.md` (`pnpm ci` = lint + test)
- Release / tags → `.agents/skills/release/SKILL.md`
- CI on PR/main: `.github/workflows/ci.yml` (lint + test required; typecheck reported but non-blocking until core is clean)

## Skill router (dev)

| Task | Skill |
|------|--------|
| CLI terminal UI | `.agents/skills/write-cli-ui/SKILL.md` |
| Core harness (loop, tools, memory, workflows) | `.agents/skills/core-dev/SKILL.md` |
| Security gate / approvals / network / MCP allow | `.agents/skills/security-dev/SKILL.md` |
| `agents/` prompts and YAML | `.agents/skills/prompt-agents/SKILL.md` |
| Spec → plan → implement | `.agents/skills/spec-plan/SKILL.md` |
| Verify before done / PR | `.agents/skills/verify/SKILL.md` |
| Tag and GitHub Release pkg | `.agents/skills/release/SKILL.md` |
