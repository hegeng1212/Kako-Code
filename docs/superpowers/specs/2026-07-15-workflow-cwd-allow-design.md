# Per-cwd Workflow “don’t ask again”

**Date:** 2026-07-15  
**Status:** Approved  

## Goal

On dynamic Workflow approval, offer **Yes, and don’t ask again for {name} in {cwd}**. After that choice, same workflow `meta.name` in that project cwd skips the confirm UI.

## Decisions

| Topic | Choice |
|-------|--------|
| Scope | Workflow tool only (by `meta.name`) |
| Storage | `Project.allowedWorkflows: string[]` on `~/.kako/index/projects.json` |
| Skip gate | Before `readWorkflowConfirm` — if name ∈ allowed for cwd → auto-allow |
| UI rows | `Yes, run it` → `Yes, and don't ask again for {name} in {cwd}` → View script → No |
| Resume | Same name gate (`resumeFromRunId` uses prior name) |

## Non-goals

- General Write/Bash/MCP cwd remember
- Settings UI to clear the list (can clear via editing projects.json later)
