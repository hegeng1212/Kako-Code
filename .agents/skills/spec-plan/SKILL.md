---
name: spec-plan
description: Use for new features or behavior changes — write or update docs/superpowers specs and plans, align .agents/skills, then implement. Enforces docs-first with the existing superpowers workflow.
---

# Spec → plan → implement

## When required

- New features
- Behavior or contract changes
- Multi-module architecture work

Skip a **new** spec for pure bugfixes that do not change boundaries — still read relevant AGENTS/skills. If the fix exposes a contract gap, document it.

## Locations (current)

| Stage | Path |
|-------|------|
| Design | `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md` |
| Plan | `docs/superpowers/plans/YYYY-MM-DD-<topic>.md` |
| Dev how-to | `.agents/skills/*/SKILL.md` |
| Hot rules | root `AGENTS.md`, `packages/*/AGENTS.md` |

## Docs-first order

1. Read root `AGENTS.md` → package `AGENTS.md` → matching skill(s).
2. Write/update **spec** (and plan if multi-step).
3. Update **skill / AGENTS** so landing spots and red lines match the design.
4. Implement code + tests.
5. Run `.agents/skills/verify/SKILL.md`.
6. If code drifted, update docs before merge.

## Spec quality bar

- No TBD / vague placeholders for decisions that block implementation.
- Name concrete modules/paths in this repo (not generic “the agent layer”).
- Respect engineering principles (no patch/enumeration designs).
- Distinguish product `skills/` from contributor `.agents/skills/`.

## Relation to product skills

Product workflows under `skills/` (e.g. brainstorming for end users) are unrelated to this contributor skill. Do not put release/process how-tos in the runtime Skill catalog.
