---
name: init
description: Initialize a new KAKO.md file with codebase documentation
---

# Init KAKO.md

Use when the user wants to bootstrap project documentation for Kako sessions.

## Goal

Create or refresh **KAKO.md** at the repository root with accurate, concise guidance the agent can rely on in future sessions.

## Workflow

1. **Inspect the repo** — Use **Read**, **Glob**, and **Bash** (read-only) to understand structure, stack, entry points, tests, and conventions. Do not guess.
2. **Check for existing docs** — If **KAKO.md** already exists, read it first and update rather than overwrite blindly.
3. **Draft KAKO.md** — Include sections such as:
   - Project overview and purpose
   - Tech stack and key directories
   - How to run, test, and build
   - Architecture notes and important conventions
   - Common tasks / gotchas specific to this repo
4. **Confirm with the user** — If the repo is large or ambiguous, use **AskUserQuestion** to confirm audience and depth before writing.
5. **Write the file** — Use **Write** to create or update `KAKO.md` at the project root.

## Rules

- Keep it factual and grounded in the codebase; avoid generic boilerplate.
- Prefer short, scannable sections over long prose.
- Do not commit unless the user asks.
- Do not call **Read** on skill files — the harness loads skills via slash commands or **Skill**.
