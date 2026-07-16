# Resume Interrupted Background Tasks

**Date:** 2026-07-14  
**Status:** Approved for implementation planning  

## Goal

After Ctrl+C / process exit, unfinished **dynamic workflows** and **background agents** remain recoverable. Re-entering the session shows a one-line hint; the user presses Enter to open approval UI (same class of gate as creating the async task), then continue work without pretending the dead process was still running.

## Decisions (from brainstorming)

| Topic | Choice |
|-------|--------|
| Scope | **B** — dynamic Workflow **and** background Agent (`run_in_background`) |
| Trigger UX | **C** — auto-detect on session open; one-line hint; `enter` opens approval |
| Workflow resume depth | **A** — soft resume via existing `resumeFromRunId` (reuse completed agents from journal) |
| Architecture | **1** — session-level interrupted checkpoint list + explicit re-approval |

## Non-goals (this phase)

- Silent auto-resume without approval
- Resuming monitor / bash background kinds
- Cross-machine restore
- Hard-re-run option UI for workflows (checkpoint soft-resume only; missing script/journal → fail + discard path)
- Making historical agents (launched before this feature) recoverable if no payload was persisted

## Problem

Background task handles live only in process memory. Disk may still say workflow `running`, and the chat footer derived elapsed time from `startedAt`, so after restart the timer kept ticking while Agents correctly showed `0 working`. Users need a truthful interrupted state **plus** a path to continue from the approval step.

## Architecture

```text
Launch workflow/agent
  → persist recoverable payload to disk
  → register in-memory BackgroundTask (live handle)

Process exit / startup reconcile
  → no live handle + incomplete work ⇒ Interrupted checkpoint
  → never show footer / Agents Working for zombies

Open session with interrupted checkpoints
  → one-line hint (enter to resume · esc to dismiss)
  → enter → approval UI
       Workflow: existing workflow confirm → launchWorkflow({ resumeFromRunId })
       Agent: light confirm → re-spawn background agent from saved input
  → success: clear checkpoint, live handle + Working
```

## Data model

### Checkpoint file

Path: `memory/sessions/{sessionId}/background/interrupted.json`

```ts
interface InterruptedBackgroundFile {
  version: 1;
  items: InterruptedBackgroundItem[];
}

type InterruptedBackgroundItem =
  | InterruptedWorkflowItem
  | InterruptedAgentItem;

interface InterruptedBackgroundItemBase {
  id: string;                 // stable checkpoint id
  taskId: string;             // original background task id when known
  status: "interrupted" | "resuming" | "discarded";
  createdAt: string;
  interruptedAt: string;
  dismissedAt?: string;       // session-local dismiss; item remains until discarded/resumed
}

interface InterruptedWorkflowItem extends InterruptedBackgroundItemBase {
  kind: "workflow";
  runId: string;
  name: string;
  description: string;
  scriptPath: string;
  args?: unknown;
  agentsDone?: number;
  agentsTotal?: number;
  currentPhase?: string;
}

interface InterruptedAgentItem extends InterruptedBackgroundItemBase {
  kind: "agent";
  description: string;
  prompt: string;
  subagentName: string;
  /** Optional; may be absent for older launches */
  childSessionId?: string;
}
```

### Launch-time persistence

- **Workflow:** already has `runs.json`. On launch (and on interrupt reconcile), upsert a workflow checkpoint referencing `runId` / `scriptPath` / args / progress summary.
- **Background agent:** today in-memory only. On `spawnSubAgentInBackground`, write agent checkpoint (or a sibling `active.json` that reconcile promotes to interrupted). Minimum fields: `description`, `prompt`, `subagentName`, `taskId`.

### Reconcile (startup + footer self-heal)

For each session:

1. Any workflow run with `running`/`pending` and **no** matching live workflow handle → mark run terminal (`stopped` or dedicated `interrupted` status with message `Interrupted: process exited`), upsert checkpoint `status: interrupted`.
2. Any persisted active agent payload without live handle → same interrupt.
3. Demote stale `agentState.state === "working"` to `blocked` with detail that background work was interrupted and can be resumed.
4. Footer renders only when `shouldRenderWorkflowFooter(diskRun, liveTask)` is true (live handle required).

Constraint: `launchWorkflow({ resumeFromRunId })` currently **rejects** if prior run is still `running`/`pending`. Reconcile must move orphans to a non-active status **before** resume is offered.

## UX

### Session open hint

When opening a session (`openChatEntrySession` / `switchChatSession`) that has one or more `interrupted` items (not discarded; optionally skip items dismissed for this process session):

```text
◉ 1 interrupted task — enter to resume · esc to dismiss
◉ N interrupted tasks — enter to resume · esc to dismiss
```

- **Enter:** open approval for the oldest (or highest-priority) interrupted item; after success/cancel/fail, if more remain, re-show hint for the next.
- **Esc:** dismiss for this CLI process visit (`dismissedAt`); checkpoint remains on disk; next open can prompt again.
- **Permanent discard:** second confirm or explicit action on the approval cancel path → `status: discarded` (or remove item).
- Normal typing/chat remains available; hint does not block the input buffer except Enter/Esc while the hint is armed (same spirit as other footer overlays — implementation may use a non-modal hint row that only steals Enter/Esc when focused/armed).

### Approval

**Workflow**

Reuse `prepareWorkflowConfirm` + `readWorkflowConfirm`. On approve:

```ts
launchWorkflow({
  sessionId,
  cwd,
  scriptPath: item.scriptPath,
  args: item.args,
  resumeFromRunId: item.runId,
});
```

Soft resume: completed agents from journal are cached; remaining work runs live.

**Background agent**

Lightweight panel: show description, subagent type, prompt summary; Continue / Cancel. Continue re-invokes the same spawn path with persisted `description` / `prompt` / `subagentName` (full re-run; no agent journal).

### Agents page

| Condition | Bucket | Preview cue |
|-----------|--------|-------------|
| Live BG or `agentState.working` | Working | unchanged |
| Interrupted checkpoint(s), no live | Needs input | e.g. `interrupted · deep-research` / `interrupted · agent: …` |
| Discarded / finished | existing rules | — |

Never classify zombie disk-`running` as Working without a live handle.

## Error handling

| Case | Behavior |
|------|----------|
| Script path missing / unreadable | Approval fails closed; show error; allow discard |
| Journal corrupt / resume rejects | Show error; leave interrupted or offer discard; no silent hard re-run in v1 |
| Agent checkpoint missing `prompt` | Mark unrecoverable; clear/discard with message |
| Resume launch throws | Checkpoint stays `interrupted`; surface error in chat |

## Engineering principles

- Explicit checkpoint + user approval — no intent-guessing guards, no harness injecting tool calls to “fix” resume.
- Prompt/tool contracts unchanged except for resume/approve surfaces that mirror the original async-create approval.
- Tests use neutral Option A/B style data where scenarios need sample text.

## Files (expected)

- `packages/core/src/background/` — interrupted store, reconcile/resume APIs; agent launch persistence
- `packages/core/src/workflows/` — align orphan status with `resumeFromRunId`; keep live-footer helpers
- `packages/cli/src/commands/chat.ts` — session-open hint wiring; resume handlers
- `packages/cli/src/ui/` — hint line, agent resume confirm (workflow confirm reused)
- `packages/cli/src/ui/agents-panel.ts` — interrupted preview / bucket cues
- Tests colocated with the above

## Acceptance

1. Start deep-research (or any workflow); Ctrl+C mid-run; restart CLI; open that session → hint appears; footer does **not** tick as live-running.
2. Enter → workflow confirm → approve → soft resume progresses; footer + Agents **Working**.
3. Decline/dismiss → no silent work; Agents stays Needs input with interrupted cue (or cleared if discarded).
4. Background agent launched with `run_in_background` survives the same restart → hint → light confirm → re-spawn → Working.
5. Agents never shows Working for post-restart zombies without a live handle.

## Open follow-ups (not blocking v1)

- Explicit “Restart from scratch” choice on workflow approval
- Persist dismiss across process if product wants quieter reopen
- Bash/monitor interrupt resume
