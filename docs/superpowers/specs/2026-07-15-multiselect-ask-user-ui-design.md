# Multi-select AskUserQuestion UI (Claude-like)

**Date:** 2026-07-15  
**Status:** Approved  

## Goal

Multi-select choice panels match Claude Code: numbered options with checkboxes, descriptions on the next line, inline **Type something** input, **Submit**, then a separator and **Chat about this**.

## Decisions

| Topic | Choice |
|-------|--------|
| Custom + checked options | Parallel — submit joins `label1, label2, custom text` |
| Type something | Focus row → type inline after the label (no separate modal) |
| Checkbox glyph | `[✓]` checked / `[ ]` unchecked |
| Descriptions | Next line, muted (not inline after label) |
| Chat about this | After horizontal separator; last row |
| Scope | Multi-select only (single-select keeps current Type something / Chat rows) |

## Non-goals

- Redesign wizard chip bar
- Change single-select layout beyond shared row helpers if needed
