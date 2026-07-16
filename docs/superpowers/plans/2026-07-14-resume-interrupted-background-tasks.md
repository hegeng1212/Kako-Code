# Resume Interrupted Background Tasks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After process exit, unfinished dynamic workflows and background agents become recoverable interrupted checkpoints; opening the session shows a one-line hint, Enter opens approval, and approve soft-resumes workflows (`resumeFromRunId`) or re-spawns background agents.

**Architecture:** Persist recoverable payloads at launch; startup/footer reconcile turns orphan disk work into `interrupted.json` checkpoints (never zombie Working/footer). Session-open hint → Workflow confirm or light Agent confirm → live `BackgroundTask` again. Agents Needs input shows interrupted cues until live.

**Tech Stack:** TypeScript, vitest, existing `@kako/core` workflow runner / task-store / sessionManager, CLI `ChatLayout` + workflow-confirm.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-14-resume-interrupted-background-tasks-design.md`
- Scope: Workflow + background Agent only (no monitor/bash)
- Soft workflow resume via `resumeFromRunId` (no hard-re-run UI in v1)
- Footer/Agents Working require a **live** in-memory background handle
- Orphan workflow runs must leave `running`/`pending` before resume (use `stopped` + `error: Interrupted: process exited`)
- Engineering principles: no intent-guessing guards; no harness-injected tool calls to “fix” resume; Option A/B neutral test data
- Do not commit unless the user explicitly asked for commits in this session (skip plan Step “Commit” or leave staged until asked)

## File Map

| File | Responsibility |
|------|----------------|
| `packages/core/src/config/paths.ts` | `getSessionInterruptedBackgroundPath(sessionId)` |
| `packages/core/src/background/interrupted-store.ts` | Load/save/upsert/list/discard interrupted checkpoints |
| `packages/core/src/background/interrupted-store.test.ts` | Store tests |
| `packages/core/src/background/reconcile-stale-work.ts` | Promote orphans → stopped + interrupted checkpoints; demote working |
| `packages/core/src/background/reconcile-stale-work.test.ts` | Extend for checkpoint upsert |
| `packages/core/src/background/agent-persist.ts` | Write/clear active agent payload used for interrupt recovery |
| `packages/core/src/agent/runtime.ts` | Persist agent payload on BG spawn; clear on complete |
| `packages/core/src/workflows/runner.ts` / `control.ts` | Upsert workflow checkpoint on launch; clear on complete |
| `packages/core/src/background/resume.ts` | `resumeInterruptedWorkflow` / `resumeInterruptedAgent` entrypoints |
| `packages/core/src/index.ts` | Export new APIs |
| `packages/cli/src/ui/interrupted-resume-hint.ts` | Pure hint line + key decision helpers |
| `packages/cli/src/ui/agent-resume-confirm.ts` | Light Continue/Cancel panel for agents |
| `packages/cli/src/ui/terminal-layout.ts` | Hint arming, Enter/Esc, panels |
| `packages/cli/src/commands/chat.ts` | Session-open scan + resume launch wiring |
| `packages/cli/src/ui/agents-panel.ts` | Interrupted preview cue |

---

### Task 1: Interrupted checkpoint store

**Files:**
- Modify: `packages/core/src/config/paths.ts`
- Create: `packages/core/src/background/interrupted-store.ts`
- Create: `packages/core/src/background/interrupted-store.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Produces:
  - `getSessionInterruptedBackgroundPath(sessionId: string): string`
  - Types `InterruptedBackgroundFile`, `InterruptedBackgroundItem`, `InterruptedWorkflowItem`, `InterruptedAgentItem` matching the spec
  - `loadInterruptedBackground(sessionId): Promise<InterruptedBackgroundFile>`
  - `saveInterruptedBackground(sessionId, file): Promise<void>`
  - `upsertInterruptedItem(sessionId, item): Promise<void>` (replace same `id` or same `kind+runId`/`kind+taskId`)
  - `listResumableInterrupted(sessionId): Promise<InterruptedBackgroundItem[]>` — `status === "interrupted"` and no process-local dismiss filter here
  - `markInterruptedDiscarded(sessionId, id): Promise<void>`
  - `removeInterruptedItem(sessionId, id): Promise<void>`
  - `INTERRUPTED_PROCESS_ERROR = "Interrupted: process exited"` (shared constant)

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/src/background/interrupted-store.test.ts
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  loadInterruptedBackground,
  upsertInterruptedItem,
  listResumableInterrupted,
  markInterruptedDiscarded,
  type InterruptedWorkflowItem,
} from "./interrupted-store.js";

describe("interrupted-store", () => {
  afterEach(() => {
    delete process.env.KAKO_HOME;
  });

  it("upserts workflow interrupt and lists it until discarded", async () => {
    process.env.KAKO_HOME = await mkdtemp(join(tmpdir(), "kako-int-"));
    const item: InterruptedWorkflowItem = {
      id: "cp-1",
      kind: "workflow",
      taskId: "wabc",
      runId: "wf_abc",
      name: "deep-research",
      description: "Deep research",
      scriptPath: "/tmp/a.js",
      status: "interrupted",
      createdAt: new Date().toISOString(),
      interruptedAt: new Date().toISOString(),
      agentsDone: 47,
      agentsTotal: 69,
    };
    await upsertInterruptedItem("sess-1", item);
    expect(await listResumableInterrupted("sess-1")).toHaveLength(1);
    await markInterruptedDiscarded("sess-1", "cp-1");
    expect(await listResumableInterrupted("sess-1")).toHaveLength(0);
    const file = await loadInterruptedBackground("sess-1");
    expect(file.items[0]?.status).toBe("discarded");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && ./node_modules/.bin/vitest run src/background/interrupted-store.test.ts`  
Expected: FAIL — module missing

- [ ] **Step 3: Implement path + store**

Add to `paths.ts`:

```ts
export function getSessionInterruptedBackgroundPath(sessionId: string): string {
  return join(getSessionMemoryDir(sessionId), "background", "interrupted.json");
}
```

Implement `interrupted-store.ts` with atomic write (tmp + rename) matching `workflows/store.ts` style; empty/missing file → `{ version: 1, items: [] }`.

- [ ] **Step 4: Run test to verify it passes**

Run: same as Step 2 — Expected: PASS

- [ ] **Step 5: Export from `packages/core/src/index.ts`**

- [ ] **Step 6: Commit** (only if user asked)

```bash
git add packages/core/src/config/paths.ts packages/core/src/background/interrupted-store.ts packages/core/src/background/interrupted-store.test.ts packages/core/src/index.ts
git commit -m "$(cat <<'EOF'
feat: persist interrupted background checkpoints on disk

EOF
)"
```

---

### Task 2: Reconcile orphans into checkpoints

**Files:**
- Modify: `packages/core/src/background/reconcile-stale-work.ts`
- Modify: `packages/core/src/background/reconcile-stale-work.test.ts`
- Modify: `packages/core/src/workflows/workflow-live.ts` (reuse `INTERRUPTED_PROCESS_ERROR` from store if duplicated)

**Interfaces:**
- Consumes: `upsertInterruptedItem`, `loadWorkflowRuns`, `updateWorkflowRun`, `sessionManager`
- Produces: `reconcileStaleBackgroundWork()` also creates workflow checkpoints; return type may add `checkpointed: number`

Also add agent active payload path used by reconcile (minimal stub file for Task 3):

- Create: `packages/core/src/background/agent-persist.ts` with:
  - `getSessionActiveAgentsPath(sessionId)` via paths helper OR store under `background/active-agents.json`
  - `listActiveAgentPayloads(sessionId)`, `upsertActiveAgentPayload`, `removeActiveAgentPayload`
  - Types with `taskId`, `description`, `prompt`, `subagentName`, `startedAt`

- [ ] **Step 1: Extend failing reconcile test**

```ts
it("checkpoints orphaned running workflows as interrupted", async () => {
  // existing writeMeta + saveWorkflowRun(runningRun...)
  await reconcileStaleBackgroundWork();
  const items = await listResumableInterrupted(sessionId);
  expect(items).toHaveLength(1);
  expect(items[0]?.kind).toBe("workflow");
  if (items[0]?.kind === "workflow") {
    expect(items[0].runId).toBe("wf_research1");
    expect(items[0].scriptPath).toBeTruthy();
  }
});
```

- [ ] **Step 2: Run test — expect FAIL** (no checkpoint yet)

- [ ] **Step 3: Update `reconcileStaleBackgroundWork`**

For each orphan run when marking stopped:

```ts
await upsertInterruptedItem(meta.id, {
  id: `wf-${run.runId}`,
  kind: "workflow",
  taskId: run.taskId,
  runId: run.runId,
  name: run.name,
  description: run.description,
  scriptPath: run.scriptPath,
  status: "interrupted",
  createdAt: run.startedAt,
  interruptedAt: new Date().toISOString(),
  agentsDone: run.agentsDone,
  agentsTotal: run.agentsTotal,
  currentPhase: run.currentPhase,
});
```

For each active agent payload without `getBackgroundTask(sessionId, taskId)` live:

```ts
await upsertInterruptedItem(meta.id, { id: `ag-${payload.taskId}`, kind: "agent", ... });
await removeActiveAgentPayload(meta.id, payload.taskId);
```

Keep demoting `agentState.working` → `blocked` with resume-oriented detail.

- [ ] **Step 4: Tests PASS**

- [ ] **Step 5: Commit** (if asked)

---

### Task 3: Persist payloads at launch; clear on complete

**Files:**
- Modify: `packages/core/src/agent/runtime.ts` (`spawnSubAgentInBackground` / `notifyAgentComplete` / `finally`)
- Modify: `packages/core/src/workflows/runner.ts` (after `saveWorkflowRun` / on complete paths)
- Modify: `packages/core/src/workflows/control.ts` (optional; prefer runner)
- Test: `packages/core/src/background/agent-persist.test.ts`
- Test: extend `packages/core/src/workflows/store.test.ts` or small `runner` unit with mocks

**Interfaces:**
- Consumes: `upsertActiveAgentPayload`, `removeActiveAgentPayload`, `upsertInterruptedItem` (optional at launch — prefer active→interrupt on reconcile only for agents; for workflows upsert interrupted only on reconcile OR keep a mirror in interrupted file only after interrupt)
- Spec preference: agents write **active** payload at launch; workflows rely on `runs.json` + reconcile checkpoint (already Task 2). Optionally also write workflow checkpoint at launch with status that reconcile refreshes — **YAGNI: rely on runs.json + Task 2**.

- [ ] **Step 1: Failing test for agent persist**

```ts
it("upserts active agent payload and removes it", async () => {
  process.env.KAKO_HOME = await mkdtemp(...);
  await upsertActiveAgentPayload("sess-a", {
    taskId: "a1",
    description: "Explore Option A",
    prompt: "Look at Option A",
    subagentName: "explore",
    startedAt: new Date().toISOString(),
  });
  expect(await listActiveAgentPayloads("sess-a")).toHaveLength(1);
  await removeActiveAgentPayload("sess-a", "a1");
  expect(await listActiveAgentPayloads("sess-a")).toHaveLength(0);
});
```

- [ ] **Step 2: Implement agent-persist + call from `spawnSubAgentInBackground` immediately after `registerBackgroundTask`, including `prompt: input.prompt`**

- [ ] **Step 3: On agent complete/stop/error `finally`, `removeActiveAgentPayload`**

- [ ] **Step 4: Verify workflow launch still registers abort + existing tests pass**

Run: `cd packages/core && ./node_modules/.bin/vitest run src/background/agent-persist.test.ts src/background/reconcile-stale-work.test.ts src/workflows/control.test.ts`

- [ ] **Step 5: Commit** (if asked)

---

### Task 4: Resume entrypoints

**Files:**
- Create: `packages/core/src/background/resume.ts`
- Create: `packages/core/src/background/resume.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Produces:
  - `resumeInterruptedWorkflow(input: { sessionId; cwd; item: InterruptedWorkflowItem }): Promise<LaunchWorkflowResult>`
  - `assertWorkflowResumable(item): Promise<void>` — scriptPath readable; prior run not running/pending
  - `buildAgentToolInputFromInterrupted(item: InterruptedAgentItem): AgentToolInput`
  - Clearing checkpoint is **caller's** job after successful live launch (CLI) OR resume helpers call `removeInterruptedItem` on success

Recommended: resume helpers launch and on success `removeInterruptedItem`.

```ts
export async function resumeInterruptedWorkflow(input: {
  sessionId: string;
  cwd: string;
  item: InterruptedWorkflowItem;
}): Promise<LaunchWorkflowResult> {
  await assertWorkflowResumable(input.item);
  const result = await launchWorkflow({
    sessionId: input.sessionId,
    cwd: input.cwd,
    scriptPath: input.item.scriptPath,
    args: input.item.args,
    resumeFromRunId: input.item.runId,
  });
  await removeInterruptedItem(input.sessionId, input.item.id);
  return result;
}
```

For agents, core should expose a callback-based resume **or** CLI calls into runtime. Prefer:

```ts
export function agentInputFromInterrupted(item: InterruptedAgentItem): AgentToolInput {
  if (!item.prompt.trim()) throw new Error("Interrupted agent is missing prompt — cannot resume");
  return {
    description: item.description,
    prompt: item.prompt,
    subagent_type: item.subagentName,
    run_in_background: true,
  };
}
```

Actual spawn stays on `AgentRuntime` / tool host in CLI Task 6 (`runtime` private spawn — use public Agent tool path or add `runtime.resumeBackgroundAgent(input)`).

Add `AgentRuntime.resumeBackgroundAgent(session, input: AgentToolInput): Promise<string>` wrapping existing private spawn background path.

- [ ] **Step 1: Failing tests for assert + agentInputFromInterrupted**

- [ ] **Step 2: Implement `resume.ts` + runtime wrapper**

- [ ] **Step 3: Mock `launchWorkflow` resume test — prior stopped, script exists**

- [ ] **Step 4: PASS + export**

- [ ] **Step 5: Commit** (if asked)

---

### Task 5: Hint + agent confirm UI (pure)

**Files:**
- Create: `packages/cli/src/ui/interrupted-resume-hint.ts`
- Create: `packages/cli/src/ui/interrupted-resume-hint.test.ts`
- Create: `packages/cli/src/ui/agent-resume-confirm.ts`
- Create: `packages/cli/src/ui/agent-resume-confirm.test.ts`

**Interfaces:**
- Produces:
  - `formatInterruptedResumeHint(count: number): string`
  - `interruptedResumeHintKey(key: string): "resume" | "dismiss" | "ignore"`
  - `renderAgentResumeConfirmRows(item: { description; subagentName; prompt }): ChoiceRow[]` (mirror workflow-confirm patterns)
  - `agentResumeDecisionFromRow(row): "continue" | "cancel"`

- [ ] **Step 1: Failing hint tests**

```ts
expect(formatInterruptedResumeHint(1)).toContain("1 interrupted task");
expect(formatInterruptedResumeHint(2)).toContain("2 interrupted tasks");
expect(interruptedResumeHintKey("enter")).toBe("resume");
expect(interruptedResumeHintKey("escape")).toBe("dismiss");
expect(interruptedResumeHintKey("a")).toBe("ignore");
```

- [ ] **Step 2: Implement hint helpers**

- [ ] **Step 3: Agent confirm Continue/Cancel rows + tests**

- [ ] **Step 4: PASS**

- [ ] **Step 5: Commit** (if asked)

---

### Task 6: Wire ChatLayout + chat.ts

**Files:**
- Modify: `packages/cli/src/ui/terminal-layout.ts`
- Modify: `packages/cli/src/commands/chat.ts`

**Interfaces:**
- Consumes: `listResumableInterrupted`, `resumeInterruptedWorkflow`, `agentInputFromInterrupted`, `prepareWorkflowConfirm`, existing `readWorkflowConfirm`, new agent confirm, `markInterruptedDiscarded` / dismiss-in-memory
- Produces: on session bind / switch / entry after transcript load, `armInterruptedResumeHint(sessionId)`

Behavior:

1. After `bindWorkflowSession` / `loadSessionFromTranscript` when opening a session, `const items = await listResumableInterrupted(sessionId)`.
2. If length > 0, set layout state `interruptedResumeQueue = items`, show hint via footer overlay line (`formatInterruptedResumeHint`).
3. While hint armed and not in other modal:
   - Enter → shift queue head → if workflow: `prepareWorkflowConfirm` + `readWorkflowConfirm`; on allow `resumeInterruptedWorkflow`; on cancel `markInterruptedDiscarded` or keep (spec: cancel ≡ dismiss this item for now — **use discard on cancel from approval**, Esc on hint = process-local dismiss without discard).
   - Process-local dismiss: keep an in-memory `Set` of dismissed checkpoint ids for this CLI process; filter queue.
4. Agent branch: `readAgentResumeConfirm` → `runtime.resumeBackgroundAgent` / tool spawn → `removeInterruptedItem`.
5. On success: `refreshWorkflowUi`, ensure `agentState` working (launch paths already set).

- [ ] **Step 1: Add layout methods (`armInterruptedResumeHint`, `clearInterruptedResumeHint`, key routing)** — keep logic thin; call chat handlers

- [ ] **Step 2: Wire `chat.ts` handlers for resume/discard**

- [ ] **Step 3: Manual smoke notes in plan execution** — unit-test handlers with mocks if feasible; otherwise rely on Task 5 + core tests

- [ ] **Step 4: Rebuild `@kako/core` (`pnpm run build` in packages/core)**

- [ ] **Step 5: Commit** (if asked)

---

### Task 7: Agents interrupted preview cue

**Files:**
- Modify: `packages/cli/src/ui/agents-panel.ts`
- Modify: `packages/cli/src/ui/agents-panel.test.ts`
- Modify: `packages/cli/src/commands/chat.ts` (pass interrupted map into panel state if needed)

**Interfaces:**
- Extend `createAgentsPanelState` / `buildAgentsRows` with optional `interruptedBySession: Record<string, string>` (one-line cue) **or** load preview that prefixes when `listResumableInterrupted` nonempty.

Prefer: in `previewForSession` / Agents open loader, if resumable interrupted exists, set preview to `interrupted · ${name}` when transcript preview would otherwise hide it — or pass separate field `interruptedLabel` on session rows.

Simplest v1:

```ts
export function interruptedPreviewCue(items: InterruptedBackgroundItem[]): string | undefined {
  if (items.length === 0) return undefined;
  const first = items[0]!;
  if (first.kind === "workflow") return `interrupted · ${first.name}`;
  return `interrupted · agent: ${first.description}`;
}
```

When building rows, if cue present and bucket is needs_input, use cue as preview (or prefix).

- [ ] **Step 1: Unit tests for cue + bucket still Needs input without live ids**

- [ ] **Step 2: Implement + wire Agents open to fetch interrupted lists for metas (limit concurrency)**

- [ ] **Step 3: PASS**

- [ ] **Step 4: Commit** (if asked)

---

### Task 8: Acceptance verification

**Files:** none new (commands only)

- [ ] **Step 1: Run core suite slices**

```bash
cd packages/core && ./node_modules/.bin/vitest run \
  src/background/interrupted-store.test.ts \
  src/background/reconcile-stale-work.test.ts \
  src/background/agent-persist.test.ts \
  src/background/resume.test.ts \
  src/workflows/workflow-live.test.ts
```

Expected: all PASS

- [ ] **Step 2: Run CLI UI tests**

```bash
cd packages/cli && ./node_modules/.bin/vitest run \
  src/ui/interrupted-resume-hint.test.ts \
  src/ui/agent-resume-confirm.test.ts \
  src/ui/agents-panel.test.ts
```

Expected: all PASS

- [ ] **Step 3: Manual checklist (from spec Acceptance)**

1. Mid-workflow Ctrl+C → restart → open session → hint; footer not live-ticking  
2. Enter → approve → soft resume → Working  
3. Esc dismiss / cancel → no silent work  
4. BG agent same path with light confirm  
5. Agents never Working for zombies  

- [ ] **Step 4: Commit** (if asked) or hand off summary

---

## Spec coverage check

| Spec requirement | Task |
|------------------|------|
| interrupted.json model | 1 |
| Launch agent persistence | 3 |
| Startup reconcile → checkpoint | 2 |
| Live footer gate | already done + 2 heal |
| Session hint Enter/Esc | 5–6 |
| Workflow confirm + soft resume | 4, 6 |
| Agent light confirm + re-spawn | 4–6 |
| Agents Needs input + cue | 7 |
| Acceptance | 8 |

## Placeholder scan

None intentionally left; workflow terminal status fixed as `stopped` + `INTERRUPTED_PROCESS_ERROR` (no new enum required for v1).
