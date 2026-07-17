---
name: deep-research
description: >-
  Deep research harness — fan-out web searches, fetch sources, adversarially verify claims, synthesize a cited report.
  - When the user wants a deep, multi-source, fact-checked research report on any topic. BEFORE invoking, check if
  the question is specific enough to research directly — if underspecified (e.g., "what car to buy" without
  budget/use-case/region), ask 2-3 clarifying questions to narrow scope. Then pass the refined question as args,
  weaving the answers in.
---

# Deep research

Use when the user wants a deep, multi-source, fact-checked research report on any topic.

## Before you start

Check whether the question is specific enough to research directly. If it is underspecified (for example, "what car to buy" without budget, use case, or region), ask 2–3 clarifying questions to narrow scope first. Then pass the refined question as skill/Workflow `args`, weaving the answers in.

## Launch

After clarifying questions, invoke immediately (no user confirmation). Prefer the Skill tool with refined `args` — the skill handler launches the background Workflow. `Workflow({ name: "deep-research", args: "..." })` is also valid.

Pass `args` as a **string** (preferred). The workflow script also accepts `{ query: "..." }` if the model passes an object.

Phases (background):

1. **Scope** — Decompose the question into search angles.
2. **Search** — Parallel WebSearch agents per angle.
3. **Fetch** — Fetch sources and extract claims.
4. **Verify** — Adversarial verification per claim.
5. **Synthesize** — Cited report with confidence notes.

## After launch

Reply briefly in the chat:

- Confirm the workflow is running in the background and what it will deliver.
- Tell the user they can enter `/workflows` anytime to watch live progress.
- Say you will notify them when it completes and present the full report.

Do **not** paste workflow internals, agent transcripts, or `/workflows` progress details in the chat.

## When the workflow completes

You receive a `<task-notification>` with the structured result.

- Present a polished report in the chat (executive summary first, then structured sections with citations).
- Save the same report as a markdown file under `<report-save-dir>` from the notification. Use a filename that matches the report title (slugified, `.md`).
- Do **not** dump raw JSON from `<result>` or intermediate agent output in the chat.

## Output style

- Lead with a concise executive summary.
- Use markdown headings and bullet lists for scanability.
- Cite sources with URLs; do not invent citations.
- Call out where evidence is weak, conflicting, or missing.

## Rules

- On `/deep-research`, the harness injects the Invoke: Workflow guide — follow that, do not call **Skill** again.
- If you already activated this skill via **Skill**, follow the re-injected Invoke: Workflow guide with the refined question as `args`; do not call **Skill** again.
- Do not call **Read** on skill files.
- Prefer **WebSearch** + **WebFetch** (via the workflow) over guessing from memory for time-sensitive topics.
