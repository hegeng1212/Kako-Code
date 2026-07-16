# Rewind UI (empty double Esc)

**Date:** 2026-07-14  
**Status:** Approved for implementation  

## Goal

In chat, when the input box is empty, Esc twice opens a Claude-style **Rewind** picker over user turns. Selecting `(current)` returns to the input. Selecting a historical turn offers four actions: restore conversation, summarize from here, summarize up to here, or cancel — conversation only (no file/code restore).

## Decisions

| Topic | Choice |
|-------|--------|
| Entry | Empty input + Esc Esc (2s arm window); non-empty keeps “Esc again to clear” |
| Restore | In-place L0 truncate to before selected user message; put prompt back in input |
| Summarize from here | Keep through selected turn; collapse everything after into one summary row |
| Summarize up to here | Collapse everything before selected message; keep selected + after |
| Never mind | Back to Rewind list |
| Fork / code restore | Out of scope |

## UX

1. **List:** title Rewind; historical turns (preview + relative time); last row `(current)`; ↑/↓; Enter / Esc.
2. **Confirm:** message preview; effect one-liner; 1–4 actions; optional context input when a Summarize action is highlighted.

## Architecture

- CLI overlay in `terminal-layout` + `rewind-panel` render helpers.
- Turn → L0 index via `session-history` helpers from `chatTurnsFromTranscript`.
- Restore: `truncateSessionTranscript` + `loadSessionFromTranscript`.
- Summarize: core `summarizeTranscriptRange` using `draftL1FromTranscript` / `formatL1Summary` + `rewriteTranscript`; optional context appended to draft note.

## Non-goals

- Restore code / dual restore  
- Session fork to a new Agents row  
- Changing ↑ input history beyond Esc clear coexistence  
