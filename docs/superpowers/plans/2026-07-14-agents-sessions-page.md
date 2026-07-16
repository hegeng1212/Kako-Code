# Agents Sessions Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the ← Agents full-screen with a Claude-style cross-cwd session list (grouped, collapsible), optional background-agent strip, compose-for-new-session, and footer actions: open / space-reply / double ctrl+x delete.

**Architecture:** Pure UI state in `agents-panel.ts` (list rows, grouping, collapse, delete-arm, reply mode). `ChatLayout` draws the screen and routes keys; `chat.ts` supplies data loaders and callbacks (list/create/resume/end session, run first turn, list BG tasks). Session grouping uses `SessionMeta.agentState` + `status`.

**Tech Stack:** TypeScript, vitest, existing CLI ansi/layout, `@kako/core` SessionManager + background task store.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-14-agents-sessions-page-design.md`
- Entry cwd frozen at panel open; new sessions use that cwd
- Esc at idle closes panel back to **entry** session (no unintended switch)
- Double Ctrl+X confirm for delete; ↑↓/Esc cancels arm
- Engineering principles: no keyword-intent patches; group rules from `agentState`/`status` contract
- Keep ← / empty-input open Agents (not only plan mode)

## File Map

| File | Responsibility |
|------|----------------|
| `packages/core/src/session/manager.ts` | `listAllSessionMetas` / richer list with meta fields for Agents |
| `packages/core/src/session/manager.test.ts` | Cross-cwd list tests |
| `packages/cli/src/ui/agents-panel.ts` | Render + pure state helpers (groups, collapse, footers, reply box) |
| `packages/cli/src/ui/agents-panel.test.ts` | Render/grouping/footer/collapse tests |
| `packages/cli/src/ui/terminal-layout.ts` | Draw, key routing, compose buffer, wire callbacks |
| `packages/cli/src/commands/chat.ts` | Open with loaders; switch/create/delete/reply hooks |
| `packages/cli/src/ui/input-footer.ts` | Ensure `← for agents` visible outside plan-only if needed |

---

### Task 1: Session list API for Agents

**Files:**
- Modify: `packages/core/src/session/manager.ts`
- Modify: `packages/core/src/session/manager.test.ts`
- Modify: `packages/core/src/index.ts` (export if needed)

**Interfaces:**
- Produces:
  - `sessionManager.listSessionMetas(options?: { limit?: number }): Promise<SessionMeta[]>` — all cwd, sort `updatedAt` desc, default limit 100
  - Existing `listSessions({ cwd })` unchanged

- [ ] **Step 1: Failing test**

```typescript
it("lists session metas across cwds", async () => {
  const a = join(home, "a");
  const b = join(home, "b");
  await mgr.createSession({ cwd: a, title: "Alpha" });
  await mgr.createSession({ cwd: b, title: "Beta" });
  const metas = await mgr.listSessionMetas();
  expect(metas.map((m) => m.title).sort()).toEqual(["Alpha", "Beta"]);
});
```

- [ ] **Step 2: Run test — expect FAIL**

`pnpm --dir packages/core exec vitest run src/session/manager.test.ts`

- [ ] **Step 3: Implement `listSessionMetas`**

Reuse `listSessions` scan loop but return full `SessionMeta` (or map Session → getSessionMeta). Prefer reading meta once and returning `SessionMeta[]`.

- [ ] **Step 4: Run tests — expect PASS**

- [ ] **Step 5: Commit** (if user requested)

---

### Task 2: Pure Agents panel model + render

**Files:**
- Rewrite: `packages/cli/src/ui/agents-panel.ts`
- Create: `packages/cli/src/ui/agents-panel.test.ts`

**Interfaces:**

```typescript
export type AgentsBucket = "needs_input" | "working" | "completed";

export interface AgentsSessionRow {
  kind: "session";
  sessionId: string;
  title: string;
  preview: string;
  cwd: string;
  updatedAt: string;
  bucket: AgentsBucket;
}

export interface AgentsGroupRow {
  kind: "group";
  bucket: AgentsBucket;
  label: string; // "Needs input" | "Working" | "Completed"
  count: number;
  collapsed: boolean;
}

export interface AgentsBgRow {
  kind: "bg";
  taskId: string;
  label: string;
  detail: string;
}

export type AgentsListRow = AgentsSessionRow | AgentsGroupRow | AgentsBgRow;

export interface AgentsPanelState {
  entryCwd: string;
  entrySessionId: string;
  modelLabel: string;
  version: string;
  rows: AgentsListRow[]; // flat navigable rows (groups + visible sessions + optional bg)
  selectedIndex: number;
  composeBuffer: string;
  /** Delete arm: session id, group bucket, or null */
  deleteArm: null | { target: "session"; sessionId: string } | { target: "group"; bucket: AgentsBucket };
  mode: "list" | "reply";
  replySessionId?: string;
  replyContext?: string;
  replyBuffer?: string;
  collapsed: Record<AgentsBucket, boolean>;
  bgTasks: BackgroundTask[];
}

export function classifySessionBucket(meta: SessionMeta): AgentsBucket;
export function buildAgentsRows(...): AgentsListRow[];
export function renderAgentsScreen(state: AgentsPanelState, cols: number, rows: number): string[];
export function agentsFooter(state: AgentsPanelState): string;
export function formatRelativeTime(iso: string, now?: number): string;
```

Footer strings (exact):

- Session selected, no arm: `enter to return · space to reply · ctrl+x to delete · ? for shortcuts`
- Group selected, expanded: `enter to collapse · ctrl+x to delete all · ? for shortcuts`
- Group collapsed: `enter to expand · ctrl+x to delete all · ? for shortcuts`
- Delete armed: `ctrl+x to confirm`
- Reply mode: `enter to send · esc to cancel` (or match image: `enter to open · space to close · …` only if still in list — prefer send/cancel for reply)

- [ ] **Step 1: Tests for classify + footer + collapse label**

```typescript
it("classifies blocked as needs_input", () => {
  expect(classifySessionBucket({
    /* minimal SessionMeta */ agentState: { state: "blocked", detail: "x", tempo: "blocked", since: "" },
    status: "active",
  } as SessionMeta)).toBe("needs_input");
});

it("footer for session vs group vs delete arm", () => {
  expect(agentsFooter(sessionSelectedState)).toContain("enter to return");
  expect(agentsFooter(groupSelectedState)).toContain("enter to collapse");
  expect(agentsFooter(deleteArmedState)).toBe(/* muted */ expect.stringContaining("ctrl+x to confirm"));
});

it("collapsed group label includes count", () => {
  const plain = stripAnsi(renderAgentsScreen(collapsedCompletedState, 80, 24).join("\n"));
  expect(plain).toMatch(/Completed\s+6/);
});
```

- [ ] **Step 2: Run — expect FAIL**

`pnpm --dir packages/cli exec vitest run src/ui/agents-panel.test.ts`

- [ ] **Step 3: Implement render**

- Header lines + tally from bucket counts  
- Group headers navigable  
- Session lines with selection bar (`ansi.userMessageBg` or muted pad)  
- Blank line + `Background agents` + bg rows when `bgTasks.length`  
- Compose line at bottom of screen area  
- Reply overlay: bordered box with `replyContext` + `> ` + `replyBuffer`

- [ ] **Step 4: Tests PASS**

- [ ] **Step 5: Commit** (if requested)

---

### Task 3: ChatLayout — open, navigate, modes

**Files:**
- Modify: `packages/cli/src/ui/terminal-layout.ts`
- Modify: `packages/cli/src/ui/input-footer.ts` / tests if `← for agents` only in plan mode

**Interfaces (callbacks on ChatLayout or openAgentsPanel options):**

```typescript
openAgentsPanel(opts: {
  entrySessionId: string;
  entryCwd: string;
  modelLabel: string;
  version: string;
  loadSessions: () => Promise<SessionMeta[]>;
  loadBgTasks: () => BackgroundTask[];
  previewForSession: (id: string) => Promise<string>;
  onOpenSession: (sessionId: string) => Promise<void>;
  onCreateSession: (text: string) => Promise<string>; // returns new session id
  onDeleteSession: (sessionId: string) => Promise<void>;
  onReplySession: (sessionId: string, text: string) => Promise<void>;
}): Promise<void>;
```

- [ ] **Step 1: Open Agents on ← when input empty (any permission mode)**

Remove plan-mode-only gating at the `cursorLeft` empty-buffer branch (keep plan shift-tab cycle). Also consider Claude’s foot note: left arrow — mirror product; if conflict with moving cursor, only when `inputBuffer.length === 0 && inputCursor === 0`.

- [ ] **Step 2: Replace `drawAgentsPanel` / `handleAgentsPanelInput`**

- Rebuild `rows` via `buildAgentsRows` after load  
- ↑↓ move `selectedIndex` among `rows`  
- Enter: session → `onOpenSession` + close; group → toggle `collapsed` + rebuild  
- Space on session → `mode = "reply"`, load preview into `replyContext`  
- Ctrl+X → arm / confirm delete (session or all ids in group)  
- Compose: when focus is compose (last sticky input) — either always bottom buffer separate from selection: typing chars goes to `composeBuffer` when not in reply; Enter on empty+session still opens; Enter with compose non-empty creates session  

**Compose vs selection keyboard (v1 rule):**

- Printable chars / backspace always edit `composeBuffer` unless `mode === "reply"` (then `replyBuffer`)  
- Enter: if compose non-empty → create; else if reply mode → send reply; else → open/collapse  
- This matches Claude (list nav + always-visible compose)

- [ ] **Step 3: Manual smoke checklist** documented in PR notes

- [ ] **Step 4: Commit** (if requested)

---

### Task 4: Wire `chat.ts`

**Files:**
- Modify: `packages/cli/src/commands/chat.ts`

- [ ] **Step 1: Pass callbacks into layout**

On Agents open / or set once on layout:

```typescript
layout.setAgentsPanelHandlers({
  loadSessions: () => sessionManager.listSessionMetas({ limit: 100 }),
  loadBgTasks: () => listBackgroundTasks(session.id).filter(t => t.kind === "agent" && !t.stopped),
  previewForSession: async (id) => { /* last user/assistant text from transcript */ },
  onOpenSession: async (id) => { session = await harness.runtime.resumeSession(id); layout.setSessionId(...); bindWorkflowSession(...); await refreshInputHistory(); },
  onCreateSession: async (text) => {
    const created = await harness.runtime.createSession();
    // ensure cwd = agents entry cwd — createSession options
    session = created;
    const userTurn = await resolveUserTurnInput(session.id, text, []);
    layout.beginTurn(text);
    await harness.runtime.runTurn(session, userTurn);
    layout.finishTurn();
    return session.id;
  },
  onDeleteSession: (id) => sessionManager.endSession(id),
  onReplySession: async (id, text) => { /* resume if needed + runTurn */ },
});
```

Detail: if `createSession` always uses process cwd, temporarily `setCwd` / pass `cwd: entryCwd` into `createSession({ cwd: entryCwd })`.

Deleting **current** entry session: after delete, create or switch to another session before close.

- [ ] **Step 2: Preview helper** — last non-empty assistant or user line from transcript (truncate ~40–60 chars)

- [ ] **Step 3: Run CLI unit tests**

```bash
pnpm --dir packages/cli exec vitest run src/ui/agents-panel.test.ts src/ui/input-footer.test.ts
pnpm --dir packages/core exec vitest run src/session/manager.test.ts
```

- [ ] **Step 4: Commit / push** (if requested)

---

## Spec coverage

| Requirement | Task |
|-------------|------|
| Cross-cwd session list + groups | 1–2 |
| Collapse group + count | 2–3 |
| Enter open session / collapse group | 3–4 |
| Space reply panel | 2–4 |
| Ctrl+X ×2 delete session / group | 3–4 |
| Compose new session at entry cwd | 3–4 |
| BG agents below blank line | 2–3 |
| ← opens Agents | 3 |

## Self-review

- No TBD in task steps  
- Footer copy matches user strings  
- Delete arm cleared on navigation  
- Plan-mode-only ← gate removed so footer promise holds
