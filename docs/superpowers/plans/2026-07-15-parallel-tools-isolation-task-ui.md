# Parallel Tools, Isolation & Task Timeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend whitelist-based same-turn tool parallelism, harden cross-session/child isolation (strong single-focus CLI), and render Claude-style TaskCreate/TaskUpdate checklist blocks on the chat timeline.

**Architecture:** Add a pure `isToolParallelizable` classifier (name + ToolDefinition security, with force-serial overrides). Generalize `loop.ts` Agent clusters into mixed parallel clusters (Agent + async launchers + readonly). Keep serial tools ordered only within one agent loop; other sessions/agents stay unlocked. CLI remains strong single-focus via existing park/buckets; add regression tests. Task UI: new timeline entry type that snapshots per-session task list after create/update.

**Tech Stack:** TypeScript, Vitest, existing `@kako/core` agent loop + tool registry, CLI `chat-blocks` / `tool-call-display`.

## Global Constraints

- Serial tools serialize **only inside one session’s one agent loop timeline** — not across sessions or parent/child agents.
- Parallel whitelist: `Agent`, immediate-return async launchers (`Workflow`), `security.readonly === true` **except** force-serial names.
- Force-serial always: `Write`, `Edit`, `Bash`, `AskUserQuestion`, `EnterPlanMode`, `ExitPlanMode`, `TaskCreate`, `TaskUpdate`, `TaskStop`, `Skill` (even if metadata marks readonly).
- Tool results appended in **original tool_use order**, not completion order.
- CLI: strong single focus — paint only focused `sessionId`.
- Nesting: `agentDepth >= 3` still blocks Agent (unchanged).
- No intent/keyword routing for parallelism; no dependency-graph scheduler; no task panel this phase.
- No runtime patches that guess user intent (engineering principles).
- Prefer not creating git commits unless the user explicitly asks (user rule); skip commit steps when that applies.

---

## File map

| File | Responsibility |
|------|----------------|
| `packages/core/src/agent/tool-parallel.ts` | Classifier + cluster partition helpers |
| `packages/core/src/agent/tool-parallel.test.ts` | Unit tests for whitelist / force-serial / partitioning |
| `packages/core/src/agent/loop.ts` | Use mixed clusters instead of Agent-only |
| `packages/core/src/agent/loop.test.ts` | Concurrency + ordering tests |
| `packages/core/src/tasks/task-store.isolation.test.ts` | Cross-session task store isolation |
| `packages/cli/src/ui/task-list-display.ts` | Pure render of checklist block |
| `packages/cli/src/ui/task-list-display.test.ts` | Render tests |
| `packages/cli/src/ui/chat-blocks.ts` | Timeline entry + render path |
| `packages/cli/src/ui/terminal-layout.ts` | Attach task-list timeline on TaskCreate/Update; activeForm activity hint |
| Optional: `packages/cli/src/ui/terminal-layout.focus-isolation.test.ts` | Focused paint regression if gaps found |

---

### Task 1: Tool parallel classifier

**Files:**
- Create: `packages/core/src/agent/tool-parallel.ts`
- Create: `packages/core/src/agent/tool-parallel.test.ts`
- Modify: `packages/core/src/index.ts` (export helpers if useful for CLI — optional; default export from agent path only)

**Interfaces:**
- Produces:
  - `FORCE_SERIAL_TOOL_NAMES: ReadonlySet<string>`
  - `ASYNC_LAUNCHER_TOOL_NAMES: ReadonlySet<string>` containing at least `"Agent"` and `"Workflow"`
  - `isToolParallelizable(name: string, definition?: Pick<ToolDefinition, "security"> | null): boolean`
  - `partitionToolCallClusters(toolCalls: Array<{ name: string }>, resolveDef: (name: string) => Pick<ToolDefinition, "security"> | undefined): Array<{ parallel: boolean; indices: number[] }>` — consecutive parallelizable names → one cluster with `parallel: true`; each serial tool alone with `parallel: false`

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, expect, it } from "vitest";
import {
  isToolParallelizable,
  partitionToolCallClusters,
} from "./tool-parallel.js";

describe("isToolParallelizable", () => {
  it("allows Agent and Workflow", () => {
    expect(isToolParallelizable("Agent")).toBe(true);
    expect(isToolParallelizable("Workflow")).toBe(true);
  });

  it("allows readonly tools from metadata", () => {
    expect(isToolParallelizable("Read", { security: { readonly: true } })).toBe(true);
    expect(isToolParallelizable("Grep", { security: { readonly: true } })).toBe(true);
  });

  it("force-serial overrides readonly metadata for AskUserQuestion and Skill", () => {
    expect(isToolParallelizable("AskUserQuestion", { security: { readonly: true } })).toBe(false);
    expect(isToolParallelizable("Skill", { security: { readonly: true } })).toBe(false);
  });

  it("rejects Write/Edit/Bash/TaskCreate", () => {
    expect(isToolParallelizable("Write", { security: { sideEffect: true } })).toBe(false);
    expect(isToolParallelizable("TaskCreate")).toBe(false);
    expect(isToolParallelizable("TaskUpdate")).toBe(false);
  });
});

describe("partitionToolCallClusters", () => {
  const defs: Record<string, { security?: { readonly?: boolean } }> = {
    Read: { security: { readonly: true } },
    Grep: { security: { readonly: true } },
    Write: { security: { sideEffect: true } },
    Agent: {},
  };

  it("clusters Read+Grep+Agent then splits on Write", () => {
    const names = ["Read", "Grep", "Agent", "Write", "Read"];
    const parts = partitionToolCallClusters(
      names.map((name) => ({ name })),
      (n) => defs[n],
    );
    expect(parts).toEqual([
      { parallel: true, indices: [0, 1, 2] },
      { parallel: false, indices: [3] },
      { parallel: true, indices: [4] },
    ]);
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

Run: `cd packages/core && pnpm exec vitest run src/agent/tool-parallel.test.ts`  
Expected: FAIL (module not found)

- [ ] **Step 3: Implement classifier**

```typescript
import type { ToolDefinition } from "@kako/shared";

export const FORCE_SERIAL_TOOL_NAMES = new Set([
  "Write",
  "Edit",
  "Bash",
  "AskUserQuestion",
  "EnterPlanMode",
  "ExitPlanMode",
  "TaskCreate",
  "TaskUpdate",
  "TaskStop",
  "Skill",
]);

export const ASYNC_LAUNCHER_TOOL_NAMES = new Set(["Agent", "Workflow"]);

export function isToolParallelizable(
  name: string,
  definition?: Pick<ToolDefinition, "security"> | null,
): boolean {
  if (FORCE_SERIAL_TOOL_NAMES.has(name)) return false;
  if (ASYNC_LAUNCHER_TOOL_NAMES.has(name)) return true;
  return definition?.security?.readonly === true;
}

export function partitionToolCallClusters(
  toolCalls: Array<{ name: string }>,
  resolveDef: (name: string) => Pick<ToolDefinition, "security"> | undefined,
): Array<{ parallel: boolean; indices: number[] }> {
  const parts: Array<{ parallel: boolean; indices: number[] }> = [];
  let i = 0;
  while (i < toolCalls.length) {
    const name = toolCalls[i]!.name;
    const parallel = isToolParallelizable(name, resolveDef(name));
    if (!parallel) {
      parts.push({ parallel: false, indices: [i] });
      i += 1;
      continue;
    }
    const indices = [i];
    i += 1;
    while (i < toolCalls.length) {
      const n = toolCalls[i]!.name;
      if (!isToolParallelizable(n, resolveDef(n))) break;
      indices.push(i);
      i += 1;
    }
    parts.push({ parallel: true, indices });
  }
  return parts;
}
```

- [ ] **Step 4: Run tests — expect PASS**

Run: `cd packages/core && pnpm exec vitest run src/agent/tool-parallel.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit** (only if user requested commits)

```bash
git add packages/core/src/agent/tool-parallel.ts packages/core/src/agent/tool-parallel.test.ts
git commit -m "$(cat <<'EOF'
feat(core): add whitelist classifier for same-turn tool parallelism

EOF
)"
```

---

### Task 2: Loop mixed parallel clusters

**Files:**
- Modify: `packages/core/src/agent/loop.ts`
- Modify: `packages/core/src/agent/loop.test.ts`

**Interfaces:**
- Consumes: `partitionToolCallClusters`, `isToolParallelizable` from Task 1
- Uses: `registry.getDefinitions()` (or look up each tool’s definition from registry) for `security`
- Replaces Agent-only cluster loop with partition-driven execute; keep `blockAgentTool` behavior inside Agent executions

- [ ] **Step 1: Write failing concurrency tests** (extend `loop.test.ts`)

Add tests that:

1. **Readonly + Agent overlap:** register slow Echo-like Read? Prefer two custom tools — if loop only uses registry.execute, register two tools `SlowRead` marked readonly via definition.security.readonly and use deferred promises; include Agent if Agent handler available. Simpler approach matching existing Agent concurrency test:

```typescript
  it("runs readonly tools concurrently with Agent in one cluster", async () => {
    // Register Read-like tool "Peek" with security.readonly + deferred gate
    // Register Agent spawn that also waits on same gate
    // Fire [Peek, Peek, Agent] in one assistant response
    // Expect maxConcurrent >= 2 (ideally 3) before releasing gate
  });

  it("does not overlap Write with neighboring Reads in the same loop", async () => {
    // Timeline: Peek(readonly), Write-like mutating tool, Peek
    // Assert Write's execute starts only after first Peek finishes;
    // second Peek starts only after Write finishes
    // Use shared events / order array of "start:{name}"
  });

  it("appends tool results in tool_use order after a parallel cluster finishes out of order", async () => {
    // Two parallel tools: slow-then-fast ordering of completion reversed vs ids
    // Assert messages tool role order matches toolCalls order
  });
```

Wire tools using existing `ToolRegistry` patterns in `loop.test.ts` (copy prior Agent cluster test).

- [ ] **Step 2: Run targeted tests — expect FAIL**

Run: `cd packages/core && pnpm exec vitest run src/agent/loop.test.ts -t "readonly tools concurrently|does not overlap Write|tool_use order"`  
Expected: FAIL (old Agent-only clustering)

- [ ] **Step 3: Implement loop partitioning**

In `runAgentLoop` after assistant toolCalls are known:

1. Build `resolveDef = (name) => registry.getDefinitions([name])[0]` (or existing registry lookup if available — if `getDefinitions` filters missing, handle undefined → treat as non-readonly).
2. Replace the `while` that only clusters `name === "Agent"` with:

```typescript
const parts = partitionToolCallClusters(toolCalls, (name) =>
  registry.getDefinitions([name])[0],
);

for (const part of parts) {
  if (shouldAbort?.()) {
    return rollbackResponse(responseText, callbacks);
  }
  const cluster = part.indices.map((idx) => toolCalls[idx]!);
  if (part.parallel && cluster.length > 1) {
    await executeParallelCluster(cluster); // generalized executeAgentCluster
  } else if (part.parallel && cluster.length === 1) {
    // Still use parallel path OR executeOneTool — either OK; prefer executeOneTool for single
    if ((await executeOneTool(cluster[0]!)).declined) choiceDeclined = true;
  } else {
    if ((await executeOneTool(cluster[0]!)).declined) choiceDeclined = true;
  }
}
```

Rename `executeAgentCluster` → `executeParallelCluster`: for each tool, if `name === "Agent" && blockAgentTool` return nested error string without execute; otherwise `registry.execute` as today. Keep ordered append after `Promise.all`.

Single-tool parallel clusters may call `executeOneTool` to reuse AskUserQuestion decline detection.

- [ ] **Step 4: Run loop tests — expect PASS**

Run: `cd packages/core && pnpm exec vitest run src/agent/loop.test.ts`  
Expected: all PASS (including old Agent cluster tests)

- [ ] **Step 5: Commit** (if requested)

```bash
git add packages/core/src/agent/loop.ts packages/core/src/agent/loop.test.ts
git commit -m "$(cat <<'EOF'
feat(core): parallelize whitelist tool clusters in the agent loop

EOF
)"
```

---

### Task 3: Cross-session isolation regressions

**Files:**
- Create: `packages/core/src/tasks/task-store.isolation.test.ts`
- Create: `packages/core/src/agent/runtime.session-isolation.test.ts` (lightweight) **or** extend existing runtime permission-mode test file if closer

**Interfaces:**
- Consumes: `createTask`, `listTasks`, `resetTaskStore` from task-store; session permission maps from runtime if testing modes

- [ ] **Step 1: Failing-first isolation tests**

```typescript
import { describe, expect, it, beforeEach } from "vitest";
import { createTask, listTasks, resetTaskStore } from "./task-store.js";

describe("task-store session isolation", () => {
  beforeEach(() => resetTaskStore());

  it("keeps tasks partitioned by sessionId under concurrent creates", async () => {
    await Promise.all([
      Promise.resolve(createTask("sess-a", { subject: "A1", description: "da" })),
      Promise.resolve(createTask("sess-b", { subject: "B1", description: "db" })),
      Promise.resolve(createTask("sess-a", { subject: "A2", description: "da2" })),
    ]);
    expect(listTasks("sess-a").map((t) => t.subject).sort()).toEqual(["A1", "A2"]);
    expect(listTasks("sess-b").map((t) => t.subject)).toEqual(["B1"]);
  });
});
```

Add a runtime test only if cheap: two sessions’ `setSessionPermissionMode` remain independent (may already exist in `runtime.permission-mode.test.ts` — if so, add one assertion comment referring to spec §2 and skip new file).

- [ ] **Step 2: Run — expect PASS if store already isolated (GREEN)** or fix races if any.

If already green, keep the test as regression lock.

- [ ] **Step 3: Document CLI focus isolation check**

Add test file `packages/cli/src/ui/terminal-layout.focus-isolation.test.ts` that:
- Creates ChatLayout (follow `session-agent-switcher.focus.test.ts` patterns)
- Simulates tool/stream callback for session B while focused on A
- Asserts focused render/output does not include B’s unique marker string

If constructing full ChatLayout is too heavy, test a smaller pure helper used by paint path — otherwise skip and rely on manual acceptance #4 with a checklist note in Task 6.

- [ ] **Step 4: Commit** (if requested)

---

### Task 4: Task checklist display (pure UI)

**Files:**
- Create: `packages/cli/src/ui/task-list-display.ts`
- Create: `packages/cli/src/ui/task-list-display.test.ts`

**Interfaces:**
- Produces:
  - `export type TaskListItemView = { id: string; subject: string; status: "pending" | "in_progress" | "completed" | "cancelled" }`
  - `export function renderTaskListBlockLines(items: TaskListItemView[]): string[]` — Claude-like markers:
    - pending: `☐` or muted open box
    - in_progress: `◐` / bold subject (pick one set; keep consistent)
    - completed: `☑` / green check via `ansi.green`
    - cancelled: muted strikethrough subject
  - `export function activityFormFromTasks(items: TaskListItemView[], activeForms?: Record<string, string>): string | undefined` — first `in_progress` item’s activeForm or subject

- [ ] **Step 1: Failing tests**

```typescript
import { describe, expect, it } from "vitest";
import { stripAnsi } from "./ansi.js";
import { renderTaskListBlockLines, activityFormFromTasks } from "./task-list-display.js";

it("renders pending and completed subjects", () => {
  const lines = renderTaskListBlockLines([
    { id: "1", subject: "Add mode footer", status: "completed" },
    { id: "2", subject: "Wire slash commands", status: "pending" },
  ]).map(stripAnsi);
  expect(lines.some((l) => l.includes("Add mode footer"))).toBe(true);
  expect(lines.some((l) => l.includes("Wire slash commands"))).toBe(true);
});

it("prefers activeForm for in_progress activity", () => {
  expect(
    activityFormFromTasks(
      [{ id: "1", subject: "Ship", status: "in_progress" }],
      { "1": "Shipping footer patch" },
    ),
  ).toBe("Shipping footer patch");
});
```

- [ ] **Step 2: Run FAIL → implement → PASS**

- [ ] **Step 3: Commit** (if requested)

---

### Task 5: Wire TaskCreate/Update into chat timeline

**Files:**
- Modify: `packages/cli/src/ui/chat-blocks.ts` — add timeline entry type `task-list` with `items: TaskListItemView[]`
- Modify: `packages/cli/src/ui/terminal-layout.ts` — on successful TaskCreate/TaskUpdate tool end for focused/live session, replace or upsert the latest `task-list` entry from `listTasks(sessionId)` (import from `@kako/core`)
- Modify: `packages/cli/src/ui/chat-blocks.test.ts` — snapshot render includes checklist
- Modify: `packages/cli/src/ui/tool-call-phrases.ts` (optional) — avoid noisy success lines when a task-list block is shown; or keep phrases but prefer not duplicating — **prefer**: still record lightweight tool row collapsed inside activity OR skip separate success row when task-list block updated in same turn

**Interfaces:**
- Consumes: `listTasks` / task types from core; `renderTaskListBlockLines`
- Timeline: when rendering turns, if entry.type === `"task-list"`, emit `renderTaskListBlockLines(entry.items)` as BODY lines
- Upsert rule: within `activeTurn.timeline`, find last `task-list` entry and overwrite `items`; if none, push new one after tool success

- [ ] **Step 1: Extend ChatTurn timeline type + failing render test**

In `chat-blocks.test.ts`:

```typescript
  it("renders task-list timeline entries as a checklist block", () => {
    const turn = /* build turn with timeline: [{ type: "task-list", items: [...] }] */;
    const plain = renderTurnToLines(turn, 80).map(stripAnsi);
    expect(plain.some((l) => l.includes("Add mode footer"))).toBe(true);
  });
```

- [ ] **Step 2: Implement type + renderer branch**

- [ ] **Step 3: Wire terminal-layout onToolEnd**

Where tool success is handled (~search `onToolEnd` / tool timeline push):

```typescript
if (name === "TaskCreate" || name === "TaskUpdate") {
  const tasks = listTasks(sessionId);
  const items = tasks.map((t) => ({
    id: t.id,
    subject: t.subject,
    status: t.status,
    ...(t.activeForm ? { activeForm: t.activeForm } : {}),
  }));
  // upsert task-list on activeTurn for sessionId
}
```

Ensure `listTasks` is available from the same process store the tools write to (in-process Map — OK for CLI).

- [ ] **Step 4: activeForm hint**

When choosing smoosh/activity waiting phrase, if session has in_progress task with activeForm, prefer `activityFormFromTasks`.

- [ ] **Step 5: Run CLI tests**

Run:

```bash
cd packages/cli && pnpm exec vitest run \
  src/ui/task-list-display.test.ts \
  src/ui/chat-blocks.test.ts \
  src/ui/tool-call-phrases.test.ts
```

Expected: PASS

- [ ] **Step 6: Commit** (if requested)

---

### Task 6: Verify acceptance

**Files:** none new (commands + short notes in `.superpowers/sdd/progress-parallel-isolation.md`)

- [ ] **Step 1: Automated suite**

```bash
cd packages/core && pnpm exec vitest run \
  src/agent/tool-parallel.test.ts \
  src/agent/loop.test.ts \
  src/tasks/task-store.isolation.test.ts \
  src/agent/runtime.permission-mode.test.ts

cd packages/cli && pnpm exec vitest run \
  src/ui/task-list-display.test.ts \
  src/ui/chat-blocks.test.ts \
  src/ui/session-agent-switcher.focus.test.ts
```

Expected: all PASS

- [ ] **Step 2: Manual checklist** (record results in progress ledger)

1. Same turn issue multiple Reads + background Agents — overlap in timing / no transcript reorder bugs  
2. Write between Reads — Write does not start until prior parallel cluster finishes  
3. Two chat sessions both writing — each transcript isolated; switch focus CLI only shows focused stream  
4. TaskCreate ×3 then TaskUpdate complete one — one checklist block updates checks  
5. Nested Agent still blocked at depth ≥ 3  

- [ ] **Step 3: Spec status** — set design doc Status to `Approved for implementation` was already OK; after ship flip to `Implemented` if desired

---

## Spec coverage self-check

| Spec requirement | Task |
|------------------|------|
| Whitelist parallel classifier (+ force-serial Skill/Ask) | Task 1 |
| Mixed clusters + ordered sink | Task 2 |
| Serial only within one agent timeline | Task 2 (implied) + Task 3 |
| Cross-session task/mode isolation | Task 3 |
| Strong single-focus CLI | Task 3 (+ manual Task 6) |
| Task checklist timeline | Tasks 4–5 |
| Nest depth unchanged | Task 6 manual |
| No panel / no conflict scheduler | Non-goals honored |

## Placeholder scan

No TBD / “implement later” left in steps above.
