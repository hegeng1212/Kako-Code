# @kako/cli

Read root [`AGENTS.md`](../../AGENTS.md) first. For UI work, load [`.agents/skills/write-cli-ui/SKILL.md`](../../.agents/skills/write-cli-ui/SKILL.md). Docs-first: update that skill (and this file if boundaries change) before behavior changes.

## Role

Terminal entry and interactive chat UI. Package `@kako/cli`; bin `kako` → `dist/index.js`.

## Dependencies

- Depends on `@kako/core` and `@kako/shared` only.
- Do not reimplement security policy, tool execution, or agent loop in the CLI — wire callbacks into `AgentRuntime`.

## Entry points

| Concern | Path |
|---------|------|
| Chat session orchestration | `src/commands/chat.ts` (`runChat`) |
| Layout / input / overlays | `src/ui/terminal-layout.ts` (`ChatLayout`) |
| CLI argv / web command | `src/cli-argv.ts`, `src/commands/web.ts`, `src/index.ts` |

## Hard rules

- UI implements **interaction contracts** (Esc, selection, exclusive interactive queue). Not semantic guards or user-intent enumeration.
- Exclusive footer interactions (tool approval, AskUserQuestion, workflow confirm, …) go through `createExclusiveInteractiveQueue` (`src/ui/interactive-queue.ts`).
- After CLI source changes: `pnpm --filter @kako/cli build` before manual runs.
- Prefer extending adjacent `*.test.ts` next to the module under test.
