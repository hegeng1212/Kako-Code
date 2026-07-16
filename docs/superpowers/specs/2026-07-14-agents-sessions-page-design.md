# Agents Sessions Page (Claude-style)

**Date:** 2026-07-14  
**Status:** Approved for implementation planning  

## Goal

Replace the left-arrow “Background agents only” full-screen with a Claude Code–style **Agents** page: cross-cwd sessions grouped by status, optional background-agent strip, bottom compose for a new session in the entry cwd, and contextual footer actions (open / reply / delete / collapse).

## Entry

- Chat footer already advertises `← for agents`.
- `←` opens Agents full screen (same keybinding as today’s `openAgentsPanel`).
- Capture **entry cwd** + **entry sessionId** when opening; new tasks use entry cwd; Esc returns to entry session without switch.

## Layout

1. Header: Kako version · model · entry cwd (shortened) · tally `N awaiting input · M working · K completed`
2. Session list (cross-project): groups **Needs input**, **Working**, **Completed**
3. Blank line, then **Background agents** section if the entry session has running BG tasks
4. Compose input: `> describe a task for a new session`
5. Contextual footer shortcuts

## Session rows

- Selectable rows + selectable **group headers**
- Row: marker · title (title / jobLabel) · one-line preview · relative time (right)
- Selection: full-width muted/dark bar
- Data: `sessionManager.listSessions()` with no cwd filter (or `listSessions({ limit })` across all); enrich from `SessionMeta.agentState`, last transcript snippet

### Grouping

| Bucket | Rule (v1) |
|--------|-----------|
| Needs input | `agentState.state === "blocked"` OR status active + awaiting user |
| Working | `agentState.state === "working"` OR active turn / running tools |
| Completed | `ended` OR `agentState.state === "done"` OR idle completed |

Exact classifier can map from existing `SessionAgentState`; adjust edge cases in implementation tests.

## Footer + keys

### Session row selected

`enter to return · space to reply · ctrl+x to delete · ? for shortcuts`

- **Enter / →**: close panel, resume/switch to that session, return to chat
- **Space**: inline reply panel (bordered box: context snippet + `> reply`); submit appends user turn on that session (may run turn or queue); then refresh list
- **Ctrl+X**: arm delete — row shows red `ctrl+x again to delete`, footer `ctrl+x to confirm`
- **Ctrl+X again**: `endSession` / delete session; clear arm
- **↑↓ / Esc**: cancel arm or exit reply mode; Esc at top level returns to entry chat session

### Group header selected

`enter to collapse · ctrl+x to delete all · ? for shortcuts`  
(when collapsed: `enter to expand · …`)

- **Enter**: toggle collapse; collapsed label `Completed N`
- **Ctrl+X ×2**: delete all sessions in that group (same confirm UX)
- **Space**: no-op

### Compose

- Enter with non-empty buffer: `createSession({ cwd: entryCwd })`, first user message = buffer (including `/slash`), start turn, refresh list (new row appears), optionally keep focus on new row
- Placeholder when empty

### Background agents section

- Shown only if entry session has BG agent tasks
- Separated by one blank line under session list
- Simplified rows; Enter returns to chat (v1); not part of group delete

## Non-goals (v1)

- Full `?` shortcuts help modal (one-line tip OK)
- Entering child BG agent transcript as primary switch target
- Changing entry cwd while on Agents page

## Files (expected)

- Expand/replace `packages/cli/src/ui/agents-panel.ts` (+ tests)
- `packages/cli/src/ui/terminal-layout.ts` — input handling, draw, reply mode
- `packages/cli/src/commands/chat.ts` — wire open/switch/create/delete/resume
- `packages/core/src/session/manager.ts` — list-all helpers / preview if needed
- Docs under `docs/superpowers/` as needed
