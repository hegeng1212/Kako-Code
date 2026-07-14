# Hermes Curated Memory Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Hermes-style bounded notes/user curated memory, additive `Memory` tool, frozen session snapshot, post-turn Background Review with optional write-approval and shared LLM budget — without shrinking main-turn builtins or MCP tools.

**Architecture:** Extend `memory.json` with per-mode `enabled` blocks; new `curated-store` + `budget` modules; register `Memory` in `BUILTIN_TOOLS`; freeze inject in `buildMessages`/runtime; schedule tool-less `complete` after turn. Phase 2 jobs only get config stubs + no-op runners behind `enabled: false`.

**Tech Stack:** TypeScript, vitest, existing `@kako/core` memory/runtime/provider patterns.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-14-hermes-curated-memory-design.md` (Approved).
- **Main turn:** `resolveAllToolNames` = all builtins (including Memory) + MCP. Never memory-only tool lists for parent agent.
- **Skills:** default + user catalog complete.
- Background Review: separate `router.complete`, **no tools**.
- No semantic “should remember” guards; caps/quotas/time only.
- Tests: Option A/B neutral data.
- Preserve hardening surfaces (cascade, MemorySearch/Get/Pin, autoRecall).

---

## File map

| File | Responsibility |
|------|----------------|
| `packages/core/src/config/memory-store.ts` | Full switchable schema + load/save |
| `packages/core/src/memory/curated-store.ts` | notes/user entries, char caps, § delimiters |
| `packages/core/src/memory/budget.ts` | shared + per-job LLM call quotas |
| `packages/core/src/memory/pending.ts` | writeApproval staging |
| `packages/core/src/memory/background-review.ts` | digest + schema parse + apply |
| `packages/core/src/tools/builtin/memory-curated.ts` | `Memory` tool |
| `packages/core/src/agent/context.ts` / `runtime.ts` | freeze inject + schedule review |
| `packages/core/src/tools/builtin/registry*.ts` | register Memory |
| `docs/requirements/02-memory.md` | document curated + config switches |

---

### Task 1: Extend memory.json schema (all modes switchable)

**Files:**
- Modify: `packages/core/src/config/memory-store.ts`
- Modify: `packages/core/src/config/memory-store.test.ts`

**Interfaces:**
- Produces: `MemorySettings` matching spec §6 (nested `enabled` on autoRecall, curated, memoryTool, backgroundReview, budget, jobs.*, writeApproval, cli)
- Migrate: flat `autoRecall: boolean` still accepted → `{ enabled: boolean }`

- [ ] **Step 1: Write failing tests** for defaults, `jobs.consolidate.enabled: false`, nested autoRecall, legacy flat bool

- [ ] **Step 2: Implement zod schema + `parseMemorySettings` / `loadMemorySettings`**

- [ ] **Step 3: Tests PASS + commit**

```bash
git commit -m "feat(config): switchable memory.json modes and job stubs"
```

---

### Task 2: Curated store (notes + user) with char caps

**Files:**
- Create: `packages/core/src/memory/curated-store.ts`
- Create: `packages/core/src/memory/curated-store.test.ts`

**Interfaces:**

```ts
export type CuratedTarget = "notes" | "user";
export function loadCuratedEntries(target: CuratedTarget): Promise<string[]>;
export function saveCuratedEntries(target: CuratedTarget, entries: string[]): Promise<void>;
export function curatedUsage(target: CuratedTarget, entries: string[], limit: number): { used: number; limit: number };
export function addCuratedEntry(...): Promise<{ ok: true } | { ok: false; error: string; current_entries: string[]; usage: string }>;
export function replaceCuratedEntry(..., oldText: string, content: string): Promise<...>;
export function removeCuratedEntry(..., oldText: string): Promise<...>;
export function formatCuratedSnapshot(notes: string[], user: string[], limits): string;
```

- Paths: `memory/curated/notes.md`, `memory/curated/user.md` (or profile/user.md — pick one in code and document; prefer `curated/user.md` + migrate empty profile).
- Delimiter: `§` between entries (Hermes-compatible).

- [ ] **Step 1: TDD add/list/cap overflow/replace/remove/ambiguous oldText**

- [ ] **Step 2: Implement**

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(memory): bounded curated notes and user entry store"
```

---

### Task 3: Memory tool (additive builtin)

**Files:**
- Create: `packages/core/src/tools/builtin/memory-curated.ts`
- Create: `packages/core/src/tools/builtin/memory-curated.test.ts`
- Modify: `registry.ts`, `registry.test.ts`, `index.test.ts`, `tool-metadata.ts`

**Hard constraint check:** After register, `DEFAULT_BUILTIN_TOOL_NAMES` includes Memory **and** prior tools; test asserts length ≥ previous + 1 and contains `Read`, `MemorySearch`, `Memory`.

- [ ] **Step 1: Failing tool tests + registry list update**

- [ ] **Step 2: Implement handler; respect `memoryTool.enabled` / `curated.enabled` — if disabled return clear error string**

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(tools): add Memory curated tool without shrinking builtin set"
```

---

### Task 4: Frozen snapshot injection

**Files:**
- Modify: `packages/core/src/agent/context.ts` (`MessageBuildOptions.curatedSnapshot?: string`)
- Modify: `packages/core/src/agent/runtime.ts` (load once per turn from session-scoped freeze cache)
- Create: `packages/core/src/memory/curated-freeze.ts` + test

**Behavior:**

```ts
// Module or WeakMap keyed by sessionId: first call loads disk → freeze; later calls return same string until process clears session.
export function getFrozenCuratedSnapshot(sessionId: string, settings: MemorySettings): Promise<string | undefined>;
export function clearFrozenCuratedSnapshot(sessionId: string): void;
```

- If `curated.enabled` or `injectFrozenSnapshot` false → undefined.
- Inject via `appendMemoryBootstrapSections` as `## Curated Memory` / `## User Profile (curated)` — after skills, before L3/pins.
- Mid-session Memory tool write must **not** change frozen string (unit test).

- [ ] **Step 1–4: TDD + implement + commit**

```bash
git commit -m "feat(memory): freeze curated snapshot for prompt-cache stable inject"
```

---

### Task 5: LLM budget / rate limiter

**Files:**
- Create: `packages/core/src/memory/budget.ts`
- Create: `packages/core/src/memory/budget.test.ts`

```ts
export type MemoryLlmJob = "backgroundReview" | "consolidate" | "curator" | "dreaming";
export function canRunMemoryLlm(job: MemoryLlmJob, settings: MemorySettings): { ok: true } | { ok: false; reason: string };
export function recordMemoryLlmCall(job: MemoryLlmJob): Promise<void>;
```

- Persist `~/.kako/index/memory-budget.json`.
- Honor `budget.enabled` and job-local max/cooldown.

- [ ] **Step 1–4: TDD + implement + commit**

```bash
git commit -m "feat(memory): shared LLM budget and per-job cooldowns"
```

---

### Task 6: writeApproval pending queue

**Files:**
- Create: `packages/core/src/memory/pending.ts` + test
- Minimal apply/reject APIs for Phase 1 (file-based); CLI can be thin later

```ts
export async function stageMemoryWrite(payload: unknown): Promise<string /* id */>;
export async function listPendingMemoryWrites(): Promise<...>;
export async function approvePendingMemoryWrite(id: string): Promise<void>;
export async function rejectPendingMemoryWrite(id: string): Promise<void>;
```

- [ ] **Step 1–4: TDD + commit**

```bash
git commit -m "feat(memory): pending queue for writeApproval gate"
```

---

### Task 7: Background Review (tool-less complete)

**Files:**
- Create: `packages/core/src/memory/background-review.ts` + test
- Modify: `packages/core/src/agent/runtime.ts` (after turn, `void scheduleBackgroundReview(...)`)

```ts
export async function runBackgroundReview(opts: {
  sessionId: SessionId;
  transcript: TranscriptMessage[];
  router: LLMRouter;
  mainModel: string;
  settings: MemorySettings;
  registry: ProviderRegistry;
}): Promise<{ ran: boolean; skippedReason?: string }>;
```

- Skip if `backgroundReview.enabled === false` or budget fail.
- Resolve model: `backgroundReview.model ?? mainModel`.
- Digest ≤ `digestMaxChars`.
- Parse JSON ops; if `writeApproval.enabled` → stage; else apply curated + facts when flags `updateCurated` / `extractFacts` true.
- **No tools** on complete request.
- Surface invariant test still passes.

- [ ] **Step 1: Parse + skip tests without live LLM (mock router)**

- [ ] **Step 2: Wire runtime post-turn; fire-and-forget with `.catch`**

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(memory): background review with auxiliary model and quotas"
```

---

### Task 8: Phase 2 job stubs + PRD + surface invariant

**Files:**
- Create: `packages/core/src/memory/jobs/index.ts` — `runMemoryJob(name)` returns `{ skipped: "disabled" }` when `!enabled`
- Modify: `docs/requirements/02-memory.md`
- Modify: `packages/core/src/memory/surface-invariant.test.ts` — assert Memory tool + Read + MemorySearch present together
- Export new APIs from `packages/core/src/index.ts`

- [ ] **Step 1: Tests for disabled jobs no-op**

- [ ] **Step 2: PRD section for curated, switches, budget**

- [ ] **Step 3: Full focused vitest run + commit**

```bash
git commit -m "docs(memory): curated Hermes phase1 complete with job stubs"
```

---

### Task 9: Verification

```bash
cd packages/shared && npm run build
cd packages/core && npx vitest run src/config/memory-store.test.ts src/memory src/tools/builtin/memory-curated.test.ts src/tools/builtin/registry.test.ts src/tools/builtin/index.test.ts src/agent/context.test.ts
```

Expected: all PASS.

---

## Self-review (plan vs spec Phase 1)

| Spec item | Task |
|-----------|------|
| Switchable config | 1 |
| Curated cap store | 2 |
| Memory tool + full surface | 3, 8 |
| Frozen inject | 4 |
| Budget | 5 |
| writeApproval | 6 |
| Background review | 7 |
| Phase 2 stubs | 8 |
| Full tool+MCP invariant | 3, 7, 8 |

Phase 2 consolidate/curator/dreaming/CLI implementation **out of this plan** (config only).

---

## Execution handoff

Plan saved to `docs/superpowers/plans/2026-07-14-hermes-curated-memory-phase1.md`.

**1. Subagent-Driven (recommended)**  
**2. Inline Execution**

Which approach?
