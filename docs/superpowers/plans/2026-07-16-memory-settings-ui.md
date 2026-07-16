# Memory Settings UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the web Memory settings tab with left vertical groups, save-on-change, unit-aware validation, and per-group restore-defaults (two-step confirm).

**Architecture:** Pure field/unit/default helpers live in `@kako/shared` (tested). `MemorySettingsTab` becomes a split-pane editor that merges patches into the full `memory.json` DTO and `PUT`s immediately. Disk units stay absolute; UI converts k ↔ tokens/chars.

**Tech Stack:** React 19, Vite, `@kako/shared`, existing `api.getMemory` / `api.saveMemory`, `apps/web/src/styles.css`.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-16-memory-settings-ui-design.md`
- Save-on-change (toggles immediate; numbers on blur/Enter after validation)
- Restore **current group only**, two-step confirm
- Token UI unit **k** (×1000), one decimal; digest UI **千字符** (×1000)
- No new HTTP endpoints; whole-file save
- No page-level Save/Discard footer
- Do not commit unless the user asks

## File map

| File | Role |
|------|------|
| `packages/shared/src/memory-settings-ui.ts` | Ranges, k conversion, group defaults merge |
| `packages/shared/src/memory-settings-ui.test.ts` | Unit tests |
| `packages/shared/src/index.ts` | Re-export |
| `apps/web/src/components/MemorySettingsTab.tsx` | Split UI + autosave + restore |
| `apps/web/src/components/SettingsPage.tsx` | Wider main when memory tab |
| `apps/web/src/styles.css` | Split nav / field error / restore confirm |

---

### Task 1: Shared model (units, ranges, group defaults)

**Files:** `packages/shared/src/memory-settings-ui.ts`, `memory-settings-ui.test.ts`, `index.ts`

- [x] Add conversion helpers (`tokensToUiK` / `uiKToTokens`, chars ↔ 千字符)
- [x] Add field ranges from spec
- [x] Add `defaultMemorySettingsSnapshot()` matching core schema defaults
- [x] Add `applyMemoryGroupDefaults(settings, groupId)`
- [x] Tests: conversion rounding, range reject, group restore isolation
- [x] `pnpm --filter @kako/shared test`

### Task 2: MemorySettingsTab rewrite + CSS

**Files:** `MemorySettingsTab.tsx`, `SettingsPage.tsx`, `styles.css`

- [x] Left nav + one active group panel
- [x] Autosave queue; validation on blur; status line
- [x] Restore two-step confirm per group
- [x] Placeholders, unit suffixes, help copy from spec
- [x] CSS for split layout; widen settings main for memory
- [x] `pnpm --filter @kako/web typecheck`

### Task 3: Verify

- [x] Shared tests pass
- [x] Web typecheck passes
- [ ] Manual smoke checklist in plan notes (optional if no browser)
