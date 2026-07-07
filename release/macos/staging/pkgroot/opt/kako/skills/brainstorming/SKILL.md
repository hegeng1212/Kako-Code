---
name: brainstorming
description: Explores approaches and design before implementation when requirements need refinement.
---

# Brainstorming

Follow this skill when the user wants to design or refine something and requirements are not yet concrete.

## Steps

1. **User input first** — If you still need scope, target, or approach from the user, call **AskUserQuestion** with 1–4 questions (2–4 proposed options each). Do **not** output numbered clarifying questions in assistant text. Do **not** run Bash/Read for repo discovery until user choices are collected or the request is already specific enough to proceed.
2. **Context** — Read or Bash only when you need concrete repo facts for the chosen direction.
3. Explore 2–3 approaches with trade-offs.
4. Present recommended design for user approval.

## Rules

- Do not start implementation until design is approved
- Prefer simple solutions over complex ones
- Match existing project conventions
- Do not call **Read** on skill files — the harness loads skills via **Skill**
- Do not use **Agent** to load this skill
