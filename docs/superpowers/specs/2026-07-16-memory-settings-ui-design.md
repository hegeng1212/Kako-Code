# Memory settings UI redesign

**Date:** 2026-07-16  
**Status:** Implemented (UI); see plan `docs/superpowers/plans/2026-07-16-memory-settings-ui.md`  
**Scope:** Web Settings →「记忆」tab only (`apps/web` MemorySettingsTab + related CSS/API usage). No change to `memory.json` on-disk schema units (absolute tokens / seconds / chars). Other Settings tabs out of scope.

## Goal

Make memory configuration scannable and hard to misconfigure:

- Too many fields on one scroll page with weak copy → **left vertical nav + one group at a time**
- Missing defaults / placeholders (e.g. max tokens left blank or set to `1`) → **visible defaults, units, min/max validation**
- Bottom unified Save/Discard → **save-on-change (option A)**
- Need escape hatch → **restore current group defaults** with two-step confirm

## Decisions

| Topic | Choice |
|-------|--------|
| Layout | Memory tab only: left vertical menu, right panel for active group |
| Save | Immediate: toggles on click; numbers/text on blur/Enter after validation |
| Dirty footer | Remove page-level Save / Discard / `beforeunload` |
| Restore defaults | **Current group only**; two-step inline confirm; then persist |
| Invalid numbers | Reject save (option A); keep last saved value; show error |
| Token UI unit | **k** (= ×1000 tokens); one decimal allowed; disk still absolute tokens |
| Large char budgets | `digestMaxChars` UI in **千字符** (×1000); disk absolute chars |
| Model context tip | Copy only: effective recall budget is `min(setting, model context window)`; no runtime model probe in this version |
| API | Keep whole-file `GET/PUT /memory`; client merges field/group then saves |
| Persistence queue | Serialize saves so rapid edits do not reorder |

## Layout

```
┌─────────────┬──────────────────────────────┐
│ 自动召回    │  Group title + intro           │
│ 策展与工具  │  Fields (label / control / help)│
│ 回合回顾    │  …                             │
│ LLM 配额    │  ──────────────────────────── │
│ 高级任务    │  [恢复本组默认]                │
└─────────────┴──────────────────────────────┘
```

- Top of panel: light status — `已保存` / `保存中…` / `保存失败：…`
- No sticky page footer for save
- Switching left nav cancels an in-progress restore confirm

### Groups

| Nav id | Label | Config slices |
|--------|-------|----------------|
| `autoRecall` | 自动召回 | `autoRecall.*` |
| `curatedTools` | 策展与工具 | `curated.*`, `memoryTool`, `writeApproval` |
| `backgroundReview` | 回合回顾 | `backgroundReview.*` |
| `budget` | LLM 配额 | `budget.*` |
| `jobs` | 高级任务 | `jobs.consolidate/curator/dreaming` enabled flags only |

## Field catalog (UI units → disk)

Conversion: `diskTokens = round(uiK * 1000)`; `diskChars = round(uiKChars * 1000)`.

### 自动召回

| Field | UI unit | Default (UI) | Range | Disk |
|-------|---------|--------------|-------|------|
| enabled | — | on | — | `autoRecall.enabled` |
| maxSnippets | 个 | `4` (optional empty → omit / system default) | `1`–`32` | `autoRecall.maxSnippets` |
| maxTokens | **k** | `0.6` | `0.1`–`1024` | `autoRecall.maxTokens` (absolute) |

Help for maxTokens must state: 实际生效为设置值与当前模型上下文窗口的较小者；填写 `1024` 表示约 1M tokens，多数模型更小。

### 策展与工具

| Field | UI unit | Default | Range | Disk |
|-------|---------|---------|-------|------|
| curated.enabled | — | on | — | |
| notesCharLimit | 字符 | `2200` | `500`–`20000` | |
| userCharLimit | 字符 | `1375` | `200`–`10000` | |
| injectFrozenSnapshot | — | on | — | |
| memoryTool.enabled | — | on | — | |
| writeApproval.enabled | — | off | — | |

### 回合回顾

| Field | UI unit | Default | Range | Disk |
|-------|---------|---------|-------|------|
| enabled | — | on | — | |
| cooldownSeconds | **秒** | `120` | `0`–`3600` | |
| maxPerHour | 次 | `20` | `0`–`200` | |
| maxPerDay | 次 | `200` | `0`–`2000` | |
| digestMaxChars | **千字符** | `12` | `1`–`100` | ×1000 → `digestMaxChars` |
| model | text | empty = session model | — | null when empty |
| updateCurated / extractFacts | — | on | — | |

### LLM 配额

| Field | UI unit | Default | Range | Disk |
|-------|---------|---------|-------|------|
| enabled | — | on | — | |
| maxLlmCallsPerHour | 次 | `40` | `1`–`500` | |
| maxLlmCallsPerDay | 次 | `300` | `1`–`5000` | |
| maxConcurrentJobs | 个 | `1` | `1`–`8` | |

### 高级任务

Three toggles default **off**. Intro copy: Phase 2 pipelines are config stubs and are not fully executed yet. Restore group = all three `enabled: false`.

## Interaction

### Save-on-change

1. Toggle → merge into in-memory settings → `api.saveMemory` immediately.
2. Number/text → local draft; on blur or Enter → validate → if ok, merge + save; if fail, `aria-invalid`, error text, do not call API; draft may stay invalid until fixed or nav away (nav away reloads from last saved for that field).
3. Optional empty numeric (maxSnippets / maxTokens): clearing field saves `undefined` so core injectCaps defaults apply.
4. Save queue: single-flight / FIFO promise chain per tab instance.

### Restore group defaults (two-step)

1. Primary button:「恢复本组默认」
2. Confirm strip: short warning +「确认恢复」/「取消」
3. Confirm → replace only that group’s keys with `parseMemorySettings({})` defaults for those keys → save whole file → refresh UI → status「已恢复默认」
4. Cancel / Esc / change nav → leave confirm mode

Defaults source of truth: same as `packages/core` `parseMemorySettings({})` / schema defaults (and injectCaps for optional autoRecall caps: snippets `4`, tokens `600`).

### Copy requirements

Every control has:

- Clear title (Chinese)
- Help paragraph (what it does + when to change it)
- Placeholder or adjacent default when numeric/text
- Unit suffix in the control (e.g. `k`, `秒`, `千字符`)

## Components / files (expected)

- Rewrite `apps/web/src/components/MemorySettingsTab.tsx` (nav + group panels + autosave + restore)
- Shared field helpers may live in the same file or small colocated modules if it grows
- CSS under existing settings styles (`settings-*` / new `memory-settings-*` layout for split pane)
- Optional: export default snapshot helper from core or duplicate default object in web aligned with schema — prefer calling a small shared/default factory if already exported; otherwise web-side mirror of schema defaults with a test that documents the numbers

No new HTTP endpoints required.

## Out of scope

- Redesigning Search / Security / Network tabs
- Per-field PATCH API
- Live lookup of the active model’s context window
- Changing on-disk token units to k
- Enabling Phase 2 job pipelines beyond existing stubs

## Success criteria

- User can change one toggle and see「已保存」without a page Save button
- Setting max tokens to `1` (meaning 1 token absolute in old UI) is impossible as absolute; UI `1` means 1k tokens and is within range; UI `0.01` is rejected
- Restore on「自动召回」does not reset budget/jobs
- Two-step confirm required before restore persists
