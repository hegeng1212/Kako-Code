# Memory Hardening (A+B) Design

**Date:** 2026-07-14  
**Status:** Approved  
**Scope:** Stabilization core (budget, flush cycle, structured flush, pins) + retrieval hardening (FTS sync, recency, auto-recall setting, telemetry)  
**Prior art:** Layered memory cascade already in `packages/core/src/memory/*`; PRD `docs/requirements/02-memory.md`

---

## 1. Goals and non-goals

### Goals

1. **Trusted budgets:** Resolve `contextWindow` from optional provider/model config; when `LLMTokenUsage.inputTokens` is available, maintain a session-level estimate ratio (EMA, clamped) so soft thresholds track reality.
2. **Reliable write-before-compact:** At most one precompact flush per compaction cycle; persist cycle state; on consolidate failure keep pins + prior L1 and surface `lastFailure`.
3. **Structured flush:** One constrained LLM call with a fixed JSON schema producing L1 section drafts, fact decisions, and pin strings — no scenario encyclopedias, no keyword “should we remember” guards.
4. **Pin write surface:** Builtin `MemoryPin` plus flush-emitted pins, sharing existing count/bytes inject caps.
5. **Retrieval hardening:** Sync FTS on append/consolidate paths; recency-aware ranking; `autoRecall` default on with config kill-switch; inject telemetry (snippet/token counts).

### Non-goals (this wave)

- CLI `kako memory search|consolidate`
- Scheduled Curator / Dreaming / real vector search
- Semantic flush triggers (chat/idle classifiers)
- Putting Agents `agentState.detail` into model RAG

### Hard constraint: preserve today’s prompt + tool surface

Memory hardening **must not** shrink or rewrite the existing turn assembly contract outside the dedicated memory bootstrap slots:

| Must remain intact | How |
|--------------------|-----|
| Agent system prompt (`definition.systemPrompt`) | Unchanged; memory blocks only **append** after env/security/skills |
| Environment, security policy, User Instructions (global) | Existing `buildSystemPromptBase` / security section order |
| Skill catalog | **Defaults first, then user-enabled** via `formatSkillsIndex` / `partitionSkillsForCatalog` — no agent YAML whitelist or harness filter that drops defaults ([engineering principles §3](../../dev/engineering-principles.md)) |
| Builtin tools (~30 including new memory tools) | Keep full `registerBuiltinTools` set; **add** `MemoryPin` (and keep `MemorySearch` / `MemoryGet`); do not remove tools for budget |
| MCP tools | Top-level agent continues `resolveAllToolNames(registry)` so every connected MCP tool stays on the LLM surface |
| Sub-agent tool YAML restrictions | Unchanged — child agents still use declared tools only |

Compaction / Tier A–C operate on the **transcript view** and memory files only. They must not strip skills from system, unregister MCP, or replace `allowedTools` with a memory-only subset for the main agent turn.

Silent flush (if implemented as an internal LLM call) uses a **separate** completion with its own message list and must **not** mutate the main turn’s tool registry or skill catalog. Prefer: structured JSON complete **without** tools; if tools are ever needed for flush, use an isolated registry limited to memory write paths — never replace the parent turn’s registry.

---

## 2. Budget calibration and compaction cycle

### Context window resolution (priority)

1. Optional `contextWindow` on provider/model config (`ProviderProfile` and/or per-model map).
2. Else default `128_000` (current `resolveContextWindow`).
3. Soft threshold: `(contextWindow - compactReserveTokens) * softCompactRatio` from `DEFAULT_MEMORY_INJECT_CAPS` / overrides in `memory.json`.

### Usage calibration (session-scoped)

- After each main completion that reports `usage.inputTokens`, compare to `estimateMessagesTokens` for the assembled messages.
- Update `SessionMeta.memoryCompact.tokenEstimateRatio` with EMA; clamp to `[0.5, 2.0]`.
- Next turn: `effectiveEstimate = estimate * ratio` before comparing to soft threshold.
- Missing usage → leave ratio at `1` (or previous value). Calibration never blocks the turn.

### Cycle state on `SessionMeta`

```ts
memoryCompact?: {
  generation: number;           // aligns with L1 compactGeneration after successful B/C
  lastFlushAt?: string;
  lastCompactAt?: string;
  lastTier?: "A" | "B" | "C";
  tokenEstimateRatio?: number;
  lastFailure?: { at: string; message: string };
}
```

Also continue appending `CompactBoundary` rows to `compaction.jsonl`.

### State machine

1. Estimate (calibrated) **below** threshold → Tier A projection only; no flush.
2. At/above threshold and no flush yet this `generation` → structured flush once → Tier B (L1 + pins accounting + recent tail) → Tier C only if still over and L1 insufficient → append boundary → bump `generation` / timestamps.
3. Same `generation`, threshold again → skip flush (`already_flushed`); may still apply view Tier B.
4. Tier C / L1 write failure → keep pins + previous L1 file; set `lastFailure`; notify via callback/CLI hint; **do not** rewrite L0 transcript to erase history.

---

## 3. Structured flush, MemoryPin, retrieval

### Structured flush

- Preconditions: soft threshold, not `sandboxReadOnly`, cycle not already flushed.
- Single `router.complete` with system prompt stating **schema only** (required keys, types, caps) — no “when user says X” examples.
- Response JSON shape:

```ts
{
  l1: {
    Goal: string;
    "Decisions+Why": string;
    "Files touched": string;
    "Open questions": string;
    Next: string;
    "Historical Context"?: string; // optional delta; mergeCumulativeL1 still owns stacking
  };
  facts: FactMergeDecision[];
  pins: string[];
}
```

- On parse failure: fall back to `draftL1FromTranscript`; empty facts/pins.
- On success: write L1 via `mergeCumulativeL1`, `applyFactDecisions`, pin upserts under inject caps, FTS sync for touched layers.

### MemoryPin tool

- Name: `MemoryPin`
- Input: `{ action: "add" | "list" | "remove"; content?: string; id?: string }`
- Caps: same as `pinsMaxCount` / `pinsMaxBytes`; reject `add` when full with current occupancy in the tool result.
- Security metadata: `defaultRiskLevel: "none"` (session-local, like Task*).
- Does not replace MemorySearch/Get.

### Retrieval hardening

| Item | Behavior |
|------|----------|
| FTS sync | After meaningful L0 append batches and after L1/L3 writes; best-effort; errors do not fail the user turn |
| Recency | Combined score: FTS relevance + day-based decay on `updated_at` |
| Auto-recall config | `~/.kako/config/memory.json`: `{ "autoRecall": true }` default; `false` skips inject; tools remain |
| Cap overrides | Optional same file fields mapping onto `MemoryInjectCaps` subsets |
| Telemetry | Cascade/auto-recall expose `injectedSnippets` / `injectedTokens` / `tierApplied`; optional `onMemoryTelemetry` on runtime callbacks |
| Agents search (optional stretch) | Same FTS over L1 (+ title if indexed); DetailLog never in `retrievedContext` |

### Message assembly order (unchanged topology)

1. System: agent prompt + env + security + **full skill catalog**  
2. Bootstrap: L4 + capped L3 + Pins  
3. Warm: L1  
4. Retrieved (if auto-recall on): bounded untrusted snippets  
5. Messages: compacted transcript **view**  
6. Current user turn  

Tools for the main agent LLM request remain the full registered set (builtins + MCP + Agent when wired).

---

## 4. Config and types

### Provider

- Extend `ProviderProfile` (and/or model entry) with optional `contextWindow?: number`.
- Resolver: `resolveModelContextWindow(registry, modelId) → number`.

### Memory settings file

Path: `~/.kako/config/memory.json`

```json
{
  "autoRecall": true,
  "injectCaps": {}
}
```

Missing file ≡ defaults (`autoRecall: true`, `DEFAULT_MEMORY_INJECT_CAPS`).

### Shared types

- Extend `SessionMeta` with `memoryCompact`.
- Flush schema types in `@kako/shared` or core `memory/flush-schema.ts` exported for tests.
- Telemetry struct for cascade/auto-recall.

---

## 5. Error handling

| Failure | Behavior |
|---------|----------|
| Flush LLM error / bad JSON | Deterministic L1 draft; no throw to user turn |
| L1 write error after flush | `lastFailure`; keep prior L1 |
| FTS sync error | Log/telemetry only |
| Pin over cap | Tool returns structured error; no partial overflow |
| Usage missing | No ratio update |

---

## 6. Testing

Neutral fixtures only (Option A/B, fake paths). Cover:

- Ratio EMA clamp and threshold effect
- Same `generation` skips second flush
- Structured flush parse success + fallback
- MemoryPin add/list/remove + cap
- `autoRecall: false` → no retrieved block; MemorySearch still works
- Recency ordering on equal-ish FTS scores
- **Regression:** `buildMessages` still contains skill catalog sections when skills provided; runtime still passes `resolveAllToolNames` (or equivalent) for top-level — assert MemoryPin present **and** prior builtins/MCP registration path unchanged
- DetailLog / `agentState.detail` never appears in system unless mirrored via L1 by the existing bridge

---

## 7. File touch map (expected)

| Area | Files |
|------|--------|
| Types / provider | `packages/shared/src/memory.ts`, `session.ts`, `provider.ts` |
| Budget / cycle | `memory/tokens.ts`, `memory/compact.ts`, `session/manager.ts`, `agent/runtime.ts` |
| Flush schema | new `memory/flush-schema.ts` (+ tests) |
| Pins tool | `tools/builtin/memory-pin.ts`, registry + security metadata + tests |
| Settings | new `config/memory-store.ts` |
| FTS / recall | `memory/index-fts.ts`, `memory/auto-recall.ts` |
| Context | `agent/context.ts` only if bootstrap helpers need telemetry hooks — **do not** remove skill injection |
| PRD | `docs/requirements/02-memory.md` (cycle, settings, preserve prompt/tools note) |

---

## 8. Success criteria

1. Long sessions trigger A→B→C using calibrated estimates, not a blind 128k assumption when the provider sets window and usage arrives.
2. At most one structured flush per `generation`; failure leaves prior L1 + pins recoverable.
3. Pins appear from tool and/or flush; reinject respects caps.
4. Auto-recall off disables silent inject; search tools still work; FTS stays fresher and recency-aware.
5. **Invariant:** after hardening, a top-level turn still ships the agent prompt, complete default+user skill catalog, and the full builtin+MCP tool list (plus MemoryPin), same as today plus additive memory capabilities.
