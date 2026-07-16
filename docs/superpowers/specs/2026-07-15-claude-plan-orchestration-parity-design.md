# Claude Plan Orchestration Parity

**Date:** 2026-07-15  
**Status:** Approved for implementation  

## Goal

Align Kako’s main/subagent orchestration, permission-mode footer, Plan vs Auto paths, and wake/recap protocols with Claude Code’s contracts — driven by **system prompt + tool description + schema**, not runtime intent routing.

## Hard constraints (engineering principles)

**Forbidden:**

1. Code that decides Plan vs Auto (regex/keyword/classifier → `setPermissionMode`).
2. Code that decides whether to open Agent / which subagent / which tool (harness-injected tool_calls, forced Explore, topic-based fan-out).
3. Prompt/tool description case manuals (“when the user says Extend DeepSeek…”). Rules and boundaries only; style aligned with Claude’s system/tool text.

**Allowed (UX / protocol / security contracts):**

- Explicit user input: `shift+tab`, `/plan` `/auto` `/manual`, ExitPlanMode confirm choices.
- Execution lifecycle of tools the model already called: parallel Agent clusters, nesting depth ≤ 3, BG notification delivery, plan file paths, footer busy icons.
- Permission enforcement **after** a mode is entered (policy table, not intent guessing).
- Stepped-away recap / SYSTEM NOTIFICATION wrappers: session lifecycle + anti–false-consent; does not choose tools for the model.

**Who chooses mode / Agent / tools:** system prompt + tool description + schema only. Model emits tool_use; harness executes as-is.

## Two expected work paths (model-driven)

| | Plan mode | Auto mode (`bypassPermissions`) |
|--|-----------|-----------------------------------|
| Entry | EnterPlanMode / `/plan` / shift+tab→plan | `/auto` / shift+tab→auto / ExitPlan confirm→auto |
| Research | Often parallel Explore BG | May Explore |
| Plan shape | `~/.kako/plans/*.md` | Chat steps OK |
| User gate | **Must** ExitPlanMode confirm | **No** plan confirm UI |
| Coding | After confirm | Direct Write/Edit |
| Footer | Teal `⏸/▶▶ plan mode on` | Yellow `⏸/▶▶ auto mode on` |

## Session Permission Mode (footer)

| UI copy | Internal `PermissionMode` | Color | This phase | Meaning |
|---------|---------------------------|-------|------------|---------|
| `manual mode on` | `default` | Neutral (`ansi.text`) | **Ship** | Default; policy approvals |
| `accept edits on` | `acceptEdits` | Magenta | **Skip** footer/cycle | Type may remain |
| `plan mode on` | `plan` | Teal (`ansi.planBorder`) | **Ship** | Research + plan file; coding via ExitPlanMode |
| `auto mode on` | `bypassPermissions` | Yellow (`ansi.yellow`) | **Ship** | Mid/low risk auto-exec; coding-autonomous |

**Footer line:** `{icon} {colored label} (shift+tab to cycle) · ← for agents`[+ `· ↓ to manage`].

- **Icon only for plan/auto:** idle `⏸`; main turn busy (streaming/tools) `▶▶`. Manual: text only, no icon.
- **Cycle:** `default` → `plan` → `bypassPermissions` → `default` (skip `acceptEdits`).
- **Slash:** `/plan [q]` (existing); add `/auto [q]`, `/manual`; with `q`, enter mode then run `q` as user message.
- **Default:** new session/chat = `default` (manual). Never harness-prejudge mode.
- **Persist:** chat → Agents → back chat keeps the same session mode.

## Subagent runtime

| Item | Contract |
|------|----------|
| Model | Inherit parent’s current model unless caller passes `model` |
| Context | New child session; independent transcript; no shared main message list |
| Prompt | Agent YAML system prompt (explore / plan / general-purpose) |
| Tools | YAML allow/deny; **depth &lt; 3** may call `Agent` again |
| Nesting | depth 0 = main; spawn depth+1; depth ≥ 3 reject with clear error |
| Parallel | Same-turn consecutive `Agent` tool calls via `Promise.all` |
| Complete | result → notify → main wake turn |

**Fix:** stop blanket `blockAgentTool: true` on all children; gate on `agentDepth`.

## SYSTEM NOTIFICATION wake

Wake text to the main model: Claude-style preamble that this is **not user input / not approval**, plus `<task-notification>` with `task-id`, `tool-use-id`, `summary`, `result`, `output-file`, `usage`, resume `note` as available. UI shows one finished line; model continues (merge explore / write plan / spawn again).

## Footer main/subagent management

When main + ≥1 live/recent subagent:

1. Input row `>`
2. Mode row with optional `· ↓ to manage`
3. **↓** focuses agent list: `● main` / `○ Explore …` (+ optional elapsed)
4. Keys: ↑/↓ select; Enter → subagent detail transcript (← back to main); `x` stop that BG child
5. Detail ← pops to main chat (not Agents page)

**Hard isolation:** Agents page lists **only** main (user-level) sessions — child/subagent sessions excluded (`parentSessionId` filter). Footer ↓ is in-session tree only.

## ExitPlanMode confirm (Plan only)

Reuse `plan-review.ts`. Show only when `permissionMode === plan` and model calls ExitPlanMode:

1. Plan body in chat
2. Choices: auto → `bypassPermissions`; manual → `acceptEdits`; revise → feedback; `ctrl+g` edit plan file

Auto mode: no ExitPlanMode confirm UI. Mis-entering Plan still uses the full gate.

## Implementation UI (after Plan confirm or already Auto)

Shared: folded Write/Edit, Bash, optional TaskCreate; BG Explore chrome; completion summary + duration; `* recap:` when stepped-away recap runs.

## Stepped-away recap

After a turn has delivered (no pending Ask/Exit), on refocus / idle / Agents headline need:

1. Inject non-user wake: fixed English template (≤40 words, plain, 1–2 sentences, goal then next step). Must not be treated as a new coding request.
2. Model reply → scrub markdown → `turn.recapText` / optional `agentState.detail` (truncate ≤64 for detail).
3. UI: `renderRecapLine` shows `* recap: …` for **any** completed turn with `recapText` — **not** planMode-gated.

Classifier detail may reuse truncated recap; classifier **must not** drive tool/mode routing.

## Parallel Agent cluster

In `loop.ts`: consecutive `Agent` calls in one assistant tool_calls batch run concurrently (`Promise.all`). Write / AskUserQuestion / ExitPlanMode and other tools remain serial.

## Prompts / tools

Align `main.md`, `plan-workflow.md`, Agent YAML, builtin tool descriptions with Claude-style **rules and boundaries** only. Plan-gate vs Auto-direct is **prompt clauses** keyed to current permissionMode — never code branching on user utterance.

## Non-goals

- Doubao (or other) product APIs
- Accept-edits footer / shift+tab (type may remain)
- Any intent classifier / scene enum / harness-forced Agent
- SendMessage / remote|worktree isolation
- Global tool parallelism beyond Agent clusters
- Subagents as switchable Agents-page sessions
- Second global Agents product in footer (`←` stays cross-session list)

## Files (expected)

- CLI: `input-footer.ts`, `terminal-layout.ts`, `plan-review.ts`, `chat-blocks.ts`, `tool-call-display.ts`, `agents-panel.ts`, `chat.ts`
- Core: `runtime.ts`, `loop.ts`, `agent-notification.ts`, exit/enter plan tools, prompts under `agents/prompts/`
- Tests colocated with the above

## Acceptance (verify)

1. Default manual; shift+tab three-way; plan/auto busy icons; Agents round-trip keeps mode; `/auto` `/manual`
2. Path A: Plan → dual Explore → plan file → Exit confirm → auto coding
3. Path B: already auto → Explore → (optional Ask) → chat plan → direct Update; **no** confirm bar
