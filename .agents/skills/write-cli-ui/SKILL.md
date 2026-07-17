---
name: write-cli-ui
description: Use when writing or modifying the Kako CLI terminal UI under packages/cli/src/ui — layout, chat transcript, tool approval, AskUserQuestion, streaming pulses, agents/rewind/workflow panels, or chat.ts wiring into ChatLayout.
---

# Write CLI UI (`packages/cli`)

Docs-first: update this skill (landing table / red lines) before changing CLI UI behavior. See also `packages/cli/AGENTS.md` and root `AGENTS.md`.

## Architecture (current)

- **`runChat`** (`packages/cli/src/commands/chat.ts`) owns session lifecycle and wires `AgentRuntime` callbacks into the UI.
- **`ChatLayout`** (`packages/cli/src/ui/terminal-layout.ts`) is the coordinator: terminal size, input modes, overlays, content scroll, mouse/click, rewind/agents panels, footer interactions.
- **Transcript model**: `ChatTurn` + timeline entries → `renderTurnToLines` in `chat-blocks.ts`.
- **Exclusive interactions**: `createExclusiveInteractiveQueue` (`interactive-queue.ts`) serializes tool approval, AskUserQuestion, workflow confirm, plan review, etc., so concurrent callers cannot overwrite a single pending resolve.
- **Dependency direction**: CLI UI → `@kako/core` / `@kako/shared`. Do not implement security policy or agent-loop semantics in display code.

## Where new features go

| Feature | Landing spot |
|---------|----------------|
| Keyboard / mouse / paste / overlay modes | `terminal-layout.ts` (`ChatLayout`, `parseInputActions`, …) |
| How a turn is painted | `chat-blocks.ts` |
| Streaming ● / breathing glyphs | `stream-pulse.ts` (do not flash whole answer lines every pulse frame) |
| Tool rows / MCP·Skill waiting dots | `tool-call-display.ts`, `tool-call-phrases.ts` |
| Tool approval copy + session-allow options | `tool-approval.ts` (`sessionAllowExtras` → core `mcp-tool` / hosts / writes / …) |
| Esc cancel during approval | `tool-confirm-abort.ts` |
| AskUserQuestion | `ask-user-question.ts`, `ask-user-question-display.ts`, `choice-picker.ts` |
| Agents list / empty-title rules | `agents-panel.ts` |
| Rewind UI | `rewind-panel.ts` + rewind Esc settlement in layout |
| Workflow confirm / footer | `workflow-confirm.ts`, `workflow-footer.ts` |
| Markdown / tables / report paths | `markdown-*.ts`, `report-path.ts` |
| Pure helpers | Adjacent small modules; do not grow `ChatLayout` without extracting |

## Tests

- Colocate `*.test.ts` next to the source file.
- Prefer extending an existing test file over inventing a generic catch-all test.

## Verify

```bash
pnpm --filter @kako/cli test
pnpm --filter @kako/cli build
```

Manual runs use `dist/`; rebuild after source changes.

## Red lines

- UI = interaction contract (Esc, selection, exclusive queue), **not** semantic guards or user-intent enumeration.
- Do not duplicate security/session-allow policy in the UI beyond mapping choices to `ToolConfirmResult` fields that core already understands.
- Keep color/ANSI usage consistent with existing `ansi.ts` / theme helpers.
