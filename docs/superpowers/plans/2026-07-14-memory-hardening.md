# Memory Hardening (A+B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make compaction budgets trustworthy, flush-once-per-cycle with structured L1/facts/pins, add `MemoryPin`, and harden FTS/auto-recall—without shrinking agent prompt, default+user skills, or builtin+MCP tool surfaces.

**Architecture:** Incremental hardening on existing `packages/core/src/memory/*` and `agent/runtime.ts`. Budgets read optional `ProviderProfile.contextWindow` and session EMA `tokenEstimateRatio`. Cycle state lives on `SessionMeta.memoryCompact`. Structured flush is a separate tool-less `router.complete`. Retrieval uses `memory.json` + FTS recency.

**Tech Stack:** TypeScript, vitest, better-sqlite3 FTS5, existing `@kako/shared` / `@kako/core` patterns.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-14-memory-hardening-design.md` (Approved).
- **Preserve surfaces:** Do not remove or filter default/user skill catalog; do not replace top-level `resolveAllToolNames`; memory blocks only append after skills; flush LLM must not mutate main turn registry.
- Flush/compact triggers: **token/budget only** — no semantic “should remember” guards.
- Tool/prompt copy: rules and schemas only — no scenario sample handbooks.
- Tests: neutral Option A/B / fake paths only.
- Engineering principles: `docs/dev/engineering-principles.md` (no patch heuristics; skill catalog completeness).

---

## File map

| File | Responsibility |
|------|----------------|
| `packages/shared/src/provider.ts` | Optional `contextWindow` / `modelContextWindows` |
| `packages/shared/src/session.ts` | `memoryCompact` on `SessionMeta` |
| `packages/shared/src/memory.ts` | Flush payload + telemetry types if shared |
| `packages/core/src/config/memory-store.ts` | Load/save `memory.json` |
| `packages/core/src/memory/tokens.ts` | Ratio EMA helpers |
| `packages/core/src/memory/context-window.ts` | Resolve window from registry+model |
| `packages/core/src/memory/flush-schema.ts` | Prompt + parse structured flush JSON |
| `packages/core/src/memory/compact.ts` | Cycle + structured flush wiring |
| `packages/core/src/memory/index-fts.ts` | Recency score; sync hooks |
| `packages/core/src/memory/auto-recall.ts` | Honor `autoRecall` + telemetry fields |
| `packages/core/src/tools/builtin/memory-pin.ts` | MemoryPin tool |
| `packages/core/src/agent/runtime.ts` | Wire window/ratio/settings/telemetry; preserve tools/skills |
| `docs/requirements/02-memory.md` | Document settings + preserve invariant |

---

### Task 1: Shared types — SessionMeta.memoryCompact + Provider contextWindow

**Files:**
- Modify: `packages/shared/src/session.ts`
- Modify: `packages/shared/src/provider.ts`
- Modify: `packages/shared/src/memory.ts` (add `MemoryFlushPayload`, `MemoryTelemetry` if not present)
- Test: `packages/shared` typecheck; optional tiny test in core later
- Modify: `docs/requirements/02-memory.md` (short “settings + cycle meta” note)

**Interfaces:**
- Produces: `SessionMemoryCompact`, `ProviderProfile.contextWindow?`, `ProviderProfile.modelContextWindows?`

- [ ] **Step 1: Add types to session.ts**

```ts
export interface SessionMemoryCompact {
  generation: number;
  lastFlushAt?: string;
  lastCompactAt?: string;
  lastTier?: "A" | "B" | "C";
  tokenEstimateRatio?: number;
  lastFailure?: { at: string; message: string };
}

// on SessionMeta:
memoryCompact?: SessionMemoryCompact;
```

- [ ] **Step 2: Add provider fields**

```ts
// ProviderProfile
/** Default context window tokens for models on this provider when not overridden. */
contextWindow?: number;
/** Per-model context window overrides (model id → tokens). */
modelContextWindows?: Record<string, number>;
```

- [ ] **Step 3: Add flush/telemetry types in memory.ts**

```ts
export interface MemoryFlushPayload {
  l1: {
    Goal: string;
    "Decisions+Why": string;
    "Files touched": string;
    "Open questions": string;
    Next: string;
    "Historical Context"?: string;
  };
  facts: FactMergeDecision[];
  pins: string[];
}

export interface MemoryTelemetry {
  tierApplied: CompactionTier | null;
  estimatedTokensBefore?: number;
  estimatedTokensAfter?: number;
  injectedSnippets?: number;
  injectedTokens?: number;
  flushed?: boolean;
  autoRecallEnabled?: boolean;
}
```

- [ ] **Step 4: Build shared**

Run: `cd packages/shared && npm run build`  
Expected: success

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/session.ts packages/shared/src/provider.ts packages/shared/src/memory.ts docs/requirements/02-memory.md
git commit -m "feat(shared): memoryCompact meta and provider contextWindow types"
```

---

### Task 2: memory.json settings store

**Files:**
- Create: `packages/core/src/config/memory-store.ts`
- Create: `packages/core/src/config/memory-store.test.ts`
- Modify: `packages/core/src/index.ts` (export load/save)

**Interfaces:**
- Produces: `loadMemorySettings()`, `MemorySettings { autoRecall: boolean; injectCaps?: Partial<MemoryInjectCaps> }`
- Consumes: `getConfigDir()`, `DEFAULT_MEMORY_INJECT_CAPS`

- [ ] **Step 1: Write failing tests**

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadMemorySettings, resolveInjectCaps } from "./memory-store.js";

describe("memory-store", () => {
  let home: string;
  let prev: string | undefined;
  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "kako-memcfg-"));
    prev = process.env.KAKO_HOME;
    process.env.KAKO_HOME = home;
  });
  afterEach(async () => {
    process.env.KAKO_HOME = prev;
    await rm(home, { recursive: true, force: true });
  });

  it("defaults autoRecall true when file missing", async () => {
    const s = await loadMemorySettings();
    expect(s.autoRecall).toBe(true);
  });

  it("reads autoRecall false", async () => {
    await mkdir(join(home, "config"), { recursive: true });
    await writeFile(join(home, "config", "memory.json"), '{"autoRecall":false}\n');
    expect((await loadMemorySettings()).autoRecall).toBe(false);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `cd packages/core && npx vitest run src/config/memory-store.test.ts`  
Expected: FAIL module not found

- [ ] **Step 3: Implement memory-store.ts** (zod parse, missing file → defaults, `resolveInjectCaps` merges partial over `DEFAULT_MEMORY_INJECT_CAPS`)

- [ ] **Step 4: Run tests — expect PASS**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(core): load memory.json autoRecall and inject cap overrides"
```

---

### Task 3: Context window resolver + token ratio EMA

**Files:**
- Create: `packages/core/src/memory/context-window.ts`
- Create: `packages/core/src/memory/context-window.test.ts`
- Modify: `packages/core/src/memory/tokens.ts`
- Create/Modify: `packages/core/src/memory/tokens.test.ts` (or extend existing)

**Interfaces:**
- Produces: `resolveModelContextWindow(registry, modelId): number`, `updateTokenEstimateRatio(prev, estimated, actualInput): number`, `applyEstimateRatio(estimate, ratio): number`
- EMA: `next = clamp(prev * 0.7 + (actual/estimated) * 0.3, 0.5, 2.0)`; if `estimated<=0` keep prev

- [ ] **Step 1: Failing tests for ratio clamp and provider override**

```ts
expect(updateTokenEstimateRatio(1, 1000, 2000)).toBeGreaterThan(1);
expect(updateTokenEstimateRatio(1, 1000, 2000)).toBeLessThanOrEqual(2);
expect(applyEstimateRatio(1000, 1.5)).toBe(1500);
```

```ts
const registry = { version: 1, active: { providerId: "p", model: "m" }, providers: [{
  id: "p", name: "P", protocol: "openai-compatible", baseUrl: "http://x", models: ["m"],
  enabled: true, contextWindow: 64000, modelContextWindows: { m: 32000 },
}]};
expect(resolveModelContextWindow(registry as never, "m")).toBe(32000);
```

- [ ] **Step 2: Implement helpers**

- [ ] **Step 3: Tests PASS + commit**

```bash
git commit -m "feat(memory): context window from provider and usage ratio EMA"
```

---

### Task 4: Compaction cycle state machine (flush once per generation)

**Files:**
- Modify: `packages/core/src/memory/compact.ts`
- Modify: `packages/core/src/memory/compact.test.ts`
- Modify: `packages/core/src/session/manager.ts` (patch `memoryCompact` via `updateSession`)
- Modify: `packages/core/src/agent/runtime.ts` (pass cycle state in/out; **do not** change skill/tool registration)

**Interfaces:**
- Consumes: `SessionMemoryCompact`, calibrated estimate
- Produces: updated `memoryCompact` fields on cascade result

- [ ] **Step 1: Failing test — same generation skips second flush**

Use tiny `contextWindow` / low threshold so cascade flushes; call twice with `memoryCompact.generation` already matching L1 gen and `lastFlushAt` set → `flush.skippedReason === "already_flushed"`.

- [ ] **Step 2: Implement**

In `runCompactionCascade`:
- Accept `memoryCompact?: SessionMemoryCompact` and `tokenEstimateRatio?: number`
- `effectiveBefore = applyEstimateRatio(tokensBefore, ratio)`
- `alreadyFlushedThisCycle = Boolean(memoryCompact?.lastFlushAt) && memoryCompact.generation === (l1?.frontmatter.compactGeneration ?? memoryCompact.generation)`
- Spec semantics: treat “cycle” as current `generation` before bump; after successful B/C flush+compact, set `generation` to L1’s `compactGeneration`, `lastFlushAt`/`lastCompactAt`/`lastTier`
- On L1 write failure: do not bump; set `lastFailure`

- [ ] **Step 3: Runtime wires `resolveModelContextWindow`, reads/writes `memoryCompact` via `sessionManager.updateSession` after cascade**

- [ ] **Step 4: Tests PASS + commit**

```bash
git commit -m "feat(memory): persist compaction cycle and skip duplicate flush"
```

---

### Task 5: Structured flush (tool-less LLM JSON)

**Files:**
- Create: `packages/core/src/memory/flush-schema.ts`
- Create: `packages/core/src/memory/flush-schema.test.ts`
- Modify: `packages/core/src/memory/compact.ts` (`preCompactFlush` uses structured path when router+model present)
- Modify: `packages/core/src/memory/compact.test.ts`

**Interfaces:**
- Produces: `FLUSH_SYSTEM_PROMPT`, `parseMemoryFlushPayload(content): MemoryFlushPayload | null`, `runStructuredFlush(...)`
- Constraint: `router.complete` messages only — **no tools**

- [ ] **Step 1: Failing parse tests**

Valid JSON with Option A goal → payload; garbage → null; fenced JSON accepted.

- [ ] **Step 2: Implement parse + system prompt (schema-only text)**

- [ ] **Step 3: Wire `preCompactFlush`**

On success: `mergeCumulativeL1` from `payload.l1`, `applyFactDecisions`, pin upserts (cap), FTS sync. On null/throw: existing deterministic draft path.

- [ ] **Step 4: Tests PASS + commit**

```bash
git commit -m "feat(memory): structured precompact flush with fixed JSON schema"
```

---

### Task 6: MemoryPin builtin tool

**Files:**
- Create: `packages/core/src/tools/builtin/memory-pin.ts`
- Create: `packages/core/src/tools/builtin/memory-pin.test.ts`
- Modify: `packages/core/src/tools/builtin/registry.ts`
- Modify: `packages/core/src/tools/builtin/registry.test.ts` (expected name list)
- Modify: `packages/core/src/tools/builtin/index.test.ts` (`REQUIRED_TOOL_TESTS`)
- Modify: `packages/core/src/security/tool-metadata.ts`

**Interfaces:**
- Produces: `MemoryPin` tool; uses `loadPins`/`savePins`/`upsertPin` for `context.sessionId`

- [ ] **Step 1: Failing tests — add/list/remove + cap reject**

- [ ] **Step 2: Implement handler; description = contract only**

- [ ] **Step 3: Register tool; security `defaultRiskLevel: "none"`**

- [ ] **Step 4: Tests PASS including registry/index gates + commit**

```bash
git commit -m "feat(tools): add MemoryPin with inject caps"
```

---

### Task 7: FTS sync + recency ranking

**Files:**
- Modify: `packages/core/src/memory/index-fts.ts`
- Modify: `packages/core/src/memory/index-fts.test.ts`
- Modify: `packages/core/src/memory/store.ts` (optional: after `append`, void `syncSessionToFts`)
- Modify: `packages/core/src/memory/compact.ts` / facts writers to sync after L1/L3

**Interfaces:**
- Change `searchMemoryFts` to sort by `relevance + recencyBoost(updated_at)` where boost decays by days (e.g. `1 / (1 + ageDays)`)

- [ ] **Step 1: Failing test — newer doc ranks above older when body match similar**

- [ ] **Step 2: Implement boost + ensure `updated_at` stored on upsert**

- [ ] **Step 3: Call `syncSessionToFts` from store.append (best-effort) and after flush/consolidate**

- [ ] **Step 4: Tests PASS + commit**

```bash
git commit -m "feat(memory): FTS recency ranking and sync on append/flush"
```

---

### Task 8: Auto-recall settings + telemetry + runtime wiring

**Files:**
- Modify: `packages/core/src/memory/auto-recall.ts`
- Modify: `packages/core/src/memory/auto-recall.test.ts` (create if needed)
- Modify: `packages/core/src/agent/runtime.ts`
- Modify: `packages/core/src/agent/runtime.ts` callbacks type — optional `onMemoryTelemetry?: (t: MemoryTelemetry) => void`
- Modify: `packages/core/src/index.ts` exports as needed

**Hard constraint check in this task:** When editing `runTurn`, keep:
- `availableSkills: skillCatalog` from `partitionSkillsForCatalog`
- `allowedTools = resolveAllToolNames(toolRegistry)`
- Do not pass a reduced tool list for compaction

- [ ] **Step 1: Test autoRecall false → empty formatted; true → hits**

- [ ] **Step 2: Runtime loads `loadMemorySettings()`; passes `enabled: settings.autoRecall`; builds `MemoryTelemetry`; updates ratio from `onStreamUsage` / completion usage when `inputTokens` present**

- [ ] **Step 3: Regression test file `packages/core/src/memory/surface-invariant.test.ts`:**

```ts
// buildMessages with partitioned skills → system contains defaults section markers from formatSkillsIndex
// DEFAULT_BUILTIN_TOOL_NAMES includes MemorySearch, MemoryGet, MemoryPin
// resolveAllToolNames after registerBuiltinTools includes all three
```

- [ ] **Step 4: Tests PASS + commit**

```bash
git commit -m "feat(memory): autoRecall config, telemetry, and surface invariant tests"
```

---

### Task 9: Compact failure surfacing + PRD sync

**Files:**
- Modify: `packages/core/src/memory/compact.ts`
- Modify: `packages/core/src/memory/compact.test.ts`
- Modify: `packages/core/src/agent/runtime.ts` (callback or attach `lastFailure` on session meta)
- Modify: `docs/requirements/02-memory.md`

- [ ] **Step 1: Test — simulate writeL1 throw → prior L1 content remains; meta.lastFailure set**

- [ ] **Step 2: Implement try/catch around Tier C / flush write; never rewrite L0 on failure**

- [ ] **Step 3: PRD bullets for memory.json, cycle meta, preserve prompt/tools**

- [ ] **Step 4: Commit**

```bash
git commit -m "fix(memory): keep prior L1 on compact failure and document settings"
```

---

### Task 10: Full verification

- [ ] **Step 1: Run focused suites**

```bash
cd packages/shared && npm run build
cd packages/core && npx vitest run src/memory src/config/memory-store.test.ts src/tools/builtin/memory-pin.test.ts src/tools/builtin/memory-search.test.ts src/tools/builtin/memory-get.test.ts src/tools/builtin/registry.test.ts src/tools/builtin/index.test.ts src/agent/context.test.ts
```

Expected: all PASS

- [ ] **Step 2: Confirm registry name list still includes prior builtins + MemoryPin**

- [ ] **Step 3: Final commit only if Task 10 produced fixups**

---

## Self-review (plan vs spec)

| Spec requirement | Task |
|------------------|------|
| Provider contextWindow + usage EMA | 3, 4, 8 |
| Cycle / flush once / lastFailure | 4, 9 |
| Structured flush JSON | 5 |
| MemoryPin + caps | 6 |
| FTS sync + recency | 7 |
| autoRecall default on + kill switch | 2, 8 |
| Telemetry | 8 |
| Preserve skills + full tools/MCP | Global + Task 8 invariant test |
| No CLI/Curator/vectors | omitted ✓ |

No TBD placeholders. Types named consistently (`SessionMemoryCompact`, `MemoryFlushPayload`, `MemoryTelemetry`).

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-14-memory-hardening.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks  
2. **Inline Execution** — this session with executing-plans and checkpoints  

Which approach?
