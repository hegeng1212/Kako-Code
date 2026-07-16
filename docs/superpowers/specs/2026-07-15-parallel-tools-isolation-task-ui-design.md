# Parallel Tools, Session Isolation & Task Timeline UI

**Date:** 2026-07-15  
**Status:** Implemented (automated tests green; manual CLI checklist in SDD progress)  
**Depends on:** `2026-07-15-claude-plan-orchestration-parity-design.md` (nest depth ≤ 3, Agent cluster, strong session permission modes)

## Goal

1. **Intra-agent tool parallelism** via an explicit whitelist (not global free-for-all).
2. **Isolation** of data, state, context, and CLI UI across concurrent sessions and nested agents.
3. **Claude-parity TaskCreate / TaskUpdate** rendering on the **chat timeline** (no separate task panel this phase).

Clarifying decision: tools that must run serially do so **only inside one session’s one agent loop timeline**. Different main sessions, and different parent/child agents, may run Write/Bash/Ask (etc.) **at the same time** without sharing that serial lock.

## Decisions (from brainstorming)

| Topic | Choice |
|-------|--------|
| Parallel strategy | **Whitelist clusters** (extend current Agent-cluster model) |
| Parallel whitelist | `Agent`, immediate-return async launchers (e.g. `Workflow`), tools with `security.readonly === true` |
| Serial (same agent timeline only) | Write, Edit, Bash, AskUserQuestion, Enter/ExitPlanMode, TaskCreate/Update/Stop, Skill, and any non-readonly non-async-launch tool |
| Multi-session CLI | **Strong single focus** — paint only focused session |
| Nesting | Keep `agentDepth`; block Agent at depth ≥ 3 |
| Task UI | Chat timeline Claude-style checklist first; no dedicated task panel |

## Approach

**Extend cluster execution in `loop.ts`:** scan tool_use in order; consecutive parallelizable tools → `Promise.all`; a serial tool flushes the cluster then runs alone. Append tool results to the transcript / model context in **original tool_use order**, not completion order.

Do **not** build a dependency/conflict graph scheduler in this phase.

---

## §1 Parallel tool contract

### Parallelizable

1. **`Agent`** (foreground or `run_in_background`) — keep and merge with the same cluster rules as readonly/async launches.
2. **Immediate-return async launchers** — tools that register background work and return at once (e.g. `Workflow`). Full sub-work completion stays on notification / wake paths.
3. **Readonly builtins** — `security.readonly === true` (e.g. Read, Grep, Glob). If metadata later marks side effects, they leave the whitelist automatically.

### Serial (within one agent timeline)

Write, Edit, Bash, AskUserQuestion, EnterPlanMode, ExitPlanMode, TaskCreate, TaskUpdate, TaskStop, Skill, and any tool that is neither readonly nor an immediate async launcher.

Confirmation / approval **pipelines stay as today** (policy + confirm UI). Parallelism does not bypass them; when a tool needs confirm, that interacts with the owning session’s focus rules (§2).

### Cluster algorithm

1. Walk the assistant’s `toolCalls` left → right.
2. Grow a cluster while tools are parallelizable; execute with `Promise.all`.
3. On a serial tool: flush cluster, execute serial tool alone, continue.
4. **Ordered sink:** push tool messages / memory appends in original tool_use order after each cluster completes.

### Nesting

Child agents obey the same parallel contract. `agentDepth >= 3` still rejects further `Agent` spawns. Child parallel execution must not write into the parent message list except via the existing notification wake protocol.

### Not in §1

Cross-session concurrency and CLI paint rules → §2. Task visual shape → §3.

---

## §2 Isolation

### Isolation keys

| Unit | Key | Notes |
|------|-----|-------|
| Main (user) session | `sessionId` | Agents list; permissionMode; transcript; task store; BG task registry |
| Subagent | `childSessionId` + `parentSessionId` | Own transcript/context; excluded from Agents list; footer ↓ in-session tree only |
| Tool execution | Session-bound registry / cwd / confirm / plan path | Never reuse another session’s confirm or plan file |

### Parallelism × isolation

- **Across main sessions:** multiple `runTurn`s may run concurrently; each has its own serial/cluster rules.
- **Across subagents:** multiple BG children under one parent may run concurrently; each child context isolated; completion → SYSTEM NOTIFICATION to parent.
- **Forbidden:** writing session A tool results into session B transcript; sharing mutable “current input / active turn” across sessions.

### CLI (strong single focus)

- Main canvas renders **only the focused `sessionId`** (turns, stream, confirm sheets, mode footer).
- Non-focused sessions keep streaming/tools in the background; user sees them after session switch or Agents.
- `parkForeground` / per-session turn buckets: non-focused events go to that session’s bucket and must not dirty the focused paint.
- Subagent detail peek: read-only child transcript; do **not** bind focused permissionMode / input state to the child (live-enter-sub is out of scope).

### Per-session state checklist

- `permissionMode` and plan file path  
- Transcript / memory  
- TaskCreate table (`sessionId`-scoped store)  
- BG task register / stop  
- AskUserQuestion / ExitPlanMode UI: only when the **owning** session is focused; if a non-focused session needs input → mark needs_input and answer after the user switches (align with Agents “Needs input”)

---

## §3 TaskCreate / TaskUpdate timeline UI

### Goal

Claude-like **checklist block** on the focused session timeline — not a separate task panel; not raw generic tool cards for create/update when a list already exists.

### Data

Existing `task-store` keyed by `sessionId` (`subject`, `description`, `status`, `activeForm`, …). Timeline renders that session’s tasks only. Do not merge child-session tasks into the parent timeline (unless a later spec says so).

### TaskCreate

- On success, show / refresh a **task list block**: status marker + `subject` per item (pending / in_progress / completed markers aligned with existing ansi style).
- Consecutive creates in one stretch update **one** list block instead of many fragmented tool rows.
- Optional short header (e.g. created count).

### TaskUpdate

- Prefer refreshing the **same** list block (check complete, set in_progress, rename subject) over a generic “Updating task” success line.
- `completed` → checked; `in_progress` → emphasize; `activeForm` feeds activity/smoosh copy when present.
- `deleted` / cancelled → remove or strike through (prefer Claude’s check-off semantics).

### In-progress feedback

If any task is `in_progress` with `activeForm`, prefer that string in the activity/smoosh area; else fall back to `subject`.

### Interaction with §1 / §2

TaskCreate/Update remain **serial within the agent timeline** so list updates stay race-free. Other sessions keep separate lists; strong focus paints only the focused session’s block.

### Out of scope (§3)

- Standalone / half-screen task panel  
- Fancy TaskGet / TaskList cards (simple tool lines or list refresh OK)  
- Cross-session global todo  

---

## Engineering constraints

- No runtime intent routing / keyword classifiers to decide parallelism or mode.
- Parallelism is a **protocol of tool metadata + known launcher names**, not utterance matching.
- Prompt/tool text: general rules only if nudges are needed (e.g. independent readonly/Agent calls may be issued together).

## Non-goals (this phase)

- Dependency-graph / write-conflict scheduler  
- Multiplexed multi-session canvas or split panes  
- accept-edits footer (unchanged from prior plan)  
- Live multi-turn attachment into child agent as primary UI  
- Changing max nest depth (remains 3)

## Expected files

- Core: `packages/core/src/agent/loop.ts` (+ tests), maybe small `tool-parallel.ts` helper for whitelist classification  
- CLI: `chat-blocks.ts` / `tool-call-display.ts` / phrases for task list block; terminal-layout focus/bucket hardening if gaps appear  
- Tests: parallel cluster ordering; cross-session no cross-talk; task list render create/update  

## Acceptance

1. Same-turn `[Read, Grep, Agent, Agent]` (or equivalent readonly + Agent mix) runs concurrently; results ordered by tool_use index.  
2. `[Read, Write, Read]` → first Read alone or with prior cluster; Write serial; second Read after Write — Write never overlaps Reads in the **same** loop.  
3. Two main sessions writing files concurrently both succeed; each transcript only its own tools.  
4. Focused CLI never paints another session’s stream; park/restore preserves modes and turns.  
5. TaskCreate × N then TaskUpdate(completed) shows one checklist block with correct checks in the focused session.
