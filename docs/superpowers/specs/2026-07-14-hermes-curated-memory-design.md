# Hermes-Style Curated Memory + Background Review Design

**Date:** 2026-07-14  
**Status:** Approved  
**Scope:** Phase 1 implementable now; Phase 2 (consolidate / Curator / Dreaming / CLI) contracted here, implemented later.  
**Related:** [Memory Hardening A+B](./2026-07-14-memory-hardening-design.md), [02-memory.md](../../requirements/02-memory.md), ADR-002

---

## 1. Goals and non-goals

### Goals

1. **Hermes-style curated stores** with hard character caps:
   - **Notes** (≈ MEMORY.md): environment / project / lessons
   - **User** (≈ USER.md): preferences, tags, communication style
2. **Tool surface for curation:** `add` / `replace` / `remove` with cap overflow errors (model consolidates itself — no semantic “should we remember” harness).
3. **Frozen bootstrap snapshot** of notes+user at session start (prefix-cache friendly); live disk updates mid-session; next session sees new snapshot.
4. **Background Review** after a turn (async, optional auxiliary model): structured ops for notes/user + fact decisions for L3.
5. **`writeApproval` gate** (default off = write freely; on = stage pending).
6. **Fully switchable modes/jobs** in `memory.json`: every feature has an independent `enabled` flag; when enabled, that job exposes its own parameters and model selection.
7. **Shared LLM budget / rate limits** so review + Phase 2 jobs cannot unbounded spend.

### Non-goals (this wave of *implementation*)

- Full Day-end Curator / Dreaming / `kako memory consolidate` **code** (Phase 2) — but their **config schema and budget hooks are defined now**.
- Replacing L0/L1 cascade or FTS tools.
- External memory providers (Mem0, etc.).

### Hard constraints

| Constraint | Rule |
|------------|------|
| **Full tool surface** | Top-level agent always gets **all default builtins (~30+) including Memory\* tools** + **all connected MCP tools** via `resolveAllToolNames`. Memory writes never run in a memory-only tool sandbox for the main turn. |
| **Skill catalog** | Defaults + user skills remain complete in system prompt. |
| **Review isolation** | Background Review / consolidate / Curator / Dreaming use **separate** `router.complete` (prefer **no tools**); they must not mutate or replace the parent turn registry. |
| **Triggers** | Review cadence and job schedules use **time / quota / enable flags** — not keyword “is this memorable” guards. |
| **File-first** | Curated entries remain Markdown files under `~/.kako/memory/`. |

---

## 2. Layering vs existing memory

| Store | Path (proposed) | Inject | Cap |
|-------|-----------------|--------|-----|
| Curated notes | `memory/curated/notes.md` (entries delimited, e.g. `§`) | Session-start frozen bootstrap | `curated.notesCharLimit` (default 2200) |
| Curated user | `memory/profile/user.md` **or** `memory/curated/user.md` unified with L4 | Same | `curated.userCharLimit` (default 1375) |
| L3 facts | `memory/facts/*` | Cap excerpt at bootstrap (existing) | inject caps |
| L1 / L2 | session summary / rolling | Existing warm / search | — |

**Recommendation:** Treat curated user as the canonical L4 profile content (entry list + optional prose header). Avoid two competing user profiles.

Session pins (`MemoryPin`) remain session-scoped and unchanged.

---

## 3. Main-turn Memory tool

**Name:** `Memory` (distinct from `MemorySearch` / `MemoryGet` / `MemoryPin`).

**Input:**

```ts
{
  target: "notes" | "user";
  action: "add" | "replace" | "remove" | "list";
  content?: string;   // add / replace new text
  oldText?: string;   // replace / remove substring match (Hermes-style)
}
```

**Behavior:**

- `list` — live entries + usage `used/limit`.
- `add` — reject exact duplicates; if over char limit → `{ ok: false, error, current_entries, usage }` (no silent drop).
- `replace` / `remove` — unique substring match; ambiguous → error asking for narrower `oldText`.
- Writes persist immediately; **do not** refresh frozen system snapshot mid-session.

**Registration:** Append to `BUILTIN_TOOLS`; security `defaultRiskLevel: "none"`. **Must appear alongside** Read/Bash/… and all MCP tools on every top-level LLM request.

---

## 4. Frozen snapshot injection

- On session start (first turn of CLI/runtime session): load notes+user → build string with usage header → pass into `buildMessages` bootstrap (`userProfile` / new `curatedNotesSection`).
- Order unchanged: agent prompt → env → security → **skills (full)** → curated notes+user → L3 excerpt → pins → L1 → retrieved → transcript view.
- Mid-session tool/review writes: disk only until next session.

---

## 5. Background Review (Phase 1)

**When:** After successful main turn completion (`void` async), if:

- `backgroundReview.enabled === true`
- Cooldown / hour / day quotas under `budget` + `backgroundReview` allow another LLM call
- Optional: skip if user turn was empty / aborted

**How:**

- Build **bounded digest** (`digestMaxChars`): recent turns verbatim + optional stub of older — not full L0 dump.
- `router.complete` with schema-only system prompt (notes/user ops + facts); **no tools**.
- Model: `backgroundReview.model` if set, else active chat model (`null` / omit = main).
- Apply ops through same curated store APIs as the Memory tool; facts via existing `applyFactDecisions`.
- If `writeApproval: true` → stage under `memory/pending/*.json` instead of applying.

**Failure:** Log telemetry; never fail the user-visible turn.

---

## 6. Configuration — every mode switchable

Path: `~/.kako/config/memory.json`

**Design rule:** Every mode/job has top-level **`enabled: boolean`**. When `enabled: false`, that subsystem is fully inert (no LLM, no schedule). When `enabled: true`, its **nested parameters and model selection** apply.

### Full schema (illustrative defaults)

```json
{
  "version": 1,
  "autoRecall": {
    "enabled": true,
    "maxSnippets": 4,
    "maxTokens": 600
  },
  "writeApproval": {
    "enabled": false
  },
  "curated": {
    "enabled": true,
    "notesCharLimit": 2200,
    "userCharLimit": 1375,
    "injectFrozenSnapshot": true
  },
  "memoryTool": {
    "enabled": true
  },
  "backgroundReview": {
    "enabled": true,
    "model": null,
    "providerId": null,
    "cooldownSeconds": 120,
    "maxPerHour": 20,
    "maxPerDay": 200,
    "digestMaxChars": 12000,
    "extractFacts": true,
    "updateCurated": true
  },
  "budget": {
    "enabled": true,
    "maxLlmCallsPerHour": 40,
    "maxLlmCallsPerDay": 300,
    "maxConcurrentJobs": 1
  },
  "jobs": {
    "consolidate": {
      "enabled": false,
      "model": null,
      "providerId": null,
      "cron": "0 3 * * *",
      "maxSessionsPerRun": 20,
      "onlyIfDirty": true,
      "writeL2": true,
      "extractFacts": true
    },
    "curator": {
      "enabled": false,
      "model": null,
      "providerId": null,
      "cron": "0 4 * * *",
      "factMaxAgeDays": 90,
      "minConfidence": 0.3,
      "promoteEpisodes": true,
      "llmContradictionCheck": false
    },
    "dreaming": {
      "enabled": false,
      "model": null,
      "providerId": null,
      "cron": "0 5 * * *",
      "maxTokensPerRun": 8000,
      "reorganizeCurated": true,
      "rebuildFts": false
    }
  },
  "cli": {
    "consolidateCommand": {
      "enabled": true
    }
  },
  "injectCaps": {}
}
```

### Semantics

| Block | `enabled: false` means |
|-------|----------------------|
| `curated` | No frozen inject; optional: Memory tool still gated by `memoryTool.enabled` |
| `memoryTool` | Do not register / hide Memory curated tool (Search/Get/Pin unaffected) |
| `backgroundReview` | No post-turn review |
| `budget` | If false, only per-job limits apply (still recommended true) |
| `jobs.consolidate` / `curator` / `dreaming` | Scheduler skips job entirely |
| `cli.consolidateCommand` | CLI subcommand may exist but refuse with “disabled in config” |
| `autoRecall` | Same as today’s kill-switch (prefer nested `enabled` for consistency; migrate flat `autoRecall: bool` as alias) |
| `writeApproval` | `enabled: true` ⇒ gate writes; `false` ⇒ free write |

### Model selection (when a job is enabled)

Each LLM-using block may set:

- `model`: string | null — null = active chat model  
- `providerId`: string | null — optional override within provider registry  

Resolution must go through existing provider registry (respect API keys / readiness). Cost controls still apply.

### Budget ledger

- Persist counters: `~/.kako/index/memory-budget.json` (`hourWindow`, `dayWindow`, `calls`, per-job counts).
- Before any memory LLM call (review or Phase 2 job): check `budget` + job-local `maxPerHour`/`maxPerDay`/`cooldown`.
- On exceed: skip with telemetry `{ skipped: "budget" | "cooldown" | "disabled" }`.

---

## 7. Phase 2 jobs (contract only in this wave)

| Job | Purpose | Config knobs (when enabled) |
|-----|---------|------------------------------|
| **consolidate** | Batch sessions with dirty L0/L1 → LLM or structured refresh → L2 + facts | cron, model, maxSessionsPerRun, onlyIfDirty, writeL2, extractFacts |
| **curator** | Decay / prune / optional contradiction LLM / L5 promote | cron, model, age/confidence, promoteEpisodes, llmContradictionCheck |
| **dreaming** | Offline reorganize curated + optional FTS rebuild | cron, model, maxTokensPerRun, reorganizeCurated, rebuildFts |
| **CLI `kako memory consolidate`** | Manual trigger of consolidate pipeline | respects `cli.consolidateCommand.enabled` + same budget |

All jobs:

- Run under `maxConcurrentJobs`
- Must not call main-turn tools/MCP
- Preserve file SoT; update FTS best-effort after writes

---

## 8. Error handling and telemetry

| Event | Behavior |
|-------|----------|
| Cap overflow on tool add | Error payload; no truncate |
| Review LLM failure | No write; telemetry |
| Pending approval | Stage only |
| Budget skip | Telemetry; chat continues |
| Job disabled | No-op |

Optional `onMemoryTelemetry` extension fields: `backgroundReviewRan`, `skippedReason`, `jobName`.

---

## 9. Testing

- **Surface invariant:** After registering Memory, `DEFAULT_BUILTIN_TOOL_NAMES` still includes prior tools; `resolveAllToolNames` with MCP mock still full set; system prompt still has skill catalog.
- Curated cap add/replace/remove/list.
- Frozen snapshot unchanged after mid-session add (inject helper returns same freeze until “new session”).
- Background review honors `enabled: false` and budget skip.
- Config: each `jobs.*.enabled: false` ⇒ job runner no-ops even if cron fires.
- Neutral Option A/B fixtures only.

---

## 10. File touch map (Phase 1)

| Area | Files |
|------|--------|
| Config | extend `config/memory-store.ts` schema |
| Curated IO | new `memory/curated-store.ts` |
| Tool | `tools/builtin/memory-curated.ts` (name `Memory`) + registry |
| Context | freeze + inject sections |
| Runtime | post-turn `scheduleBackgroundReview` |
| Budget | `memory/budget.ts` |
| Pending | `memory/pending.ts` |
| Tests | curated, review, budget, surface invariant |
| Docs | PRD + this spec |

Phase 2 later: `memory/jobs/*`, CLI command, scheduler hook (reuse existing cron if present).

---

## 11. Success criteria

1. User/agent can curate notes+user via Memory tool under char caps; overflow forces explicit consolidate via tools.
2. Main turn always has **full builtins + MCP**; Memory is additive only.
3. Background Review is fully switchable; when on, model/digest/quotas configurable.
4. Every job/mode in `memory.json` has **independent `enabled`** and **per-job parameters + model selection**.
5. Shared budget prevents unbounded review/job LLM spend.
6. Phase 2 jobs are specified and can plug into the same switches/budget without redesigning Phase 1.

---

## 12. Implementation phasing

| Phase | Deliver |
|-------|---------|
| **1** | curated store + Memory tool + frozen inject + background review + writeApproval + config switches + budget |
| **2** | consolidate job + CLI + curator job + dreaming job (all behind their `enabled` flags) |
