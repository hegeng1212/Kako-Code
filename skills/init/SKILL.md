---
name: init
description: Initialize a new KAKO.md file with codebase documentation.
---

# Init KAKO.md

Invoke via **Skill(init)** when the user types `init` or `/init`.

The harness injects the canonical init prompt after **Skill(init)** activates — follow that prompt, not this file's workflow verbatim.

## Goal

Create or refresh **KAKO.md** at the repository root with accurate, concise guidance the agent can rely on in future sessions.

## Rules

- Keep it factual and grounded in the codebase; avoid generic boilerplate.
- Prefer short, scannable sections over long prose.
- Do not commit unless the user asks.
