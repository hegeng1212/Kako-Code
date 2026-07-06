# Builtin Tool Testing Standard

Every tool under `packages/core/src/tools/builtin/` **must** ship with tests before merge.

## Required test file

| Tool | Test file(s) |
|------|----------------|
| `<Name>` | `<name>.test.ts` (unit + adversarial) |
| integration with agent loop | `<name>.integration.test.ts` when tool participates in multi-turn flows |

`index.test.ts` enforces that every registered built-in has a dedicated test file.

## Three layers

### 1. Schema & parsing (unit)

- Definition: `name`, `required`, `additionalProperties`, key field descriptions
- Parsers / normalizers: valid inputs, boundary values, type coercion edges
- Pure functions exported for testability (`parseX`, `resolveY`, `assertZ`)

### 2. Handler (unit / integration)

- Happy path with real filesystem or mocked host (`askUserQuestion`, `spawnSubAgent`)
- Return shape matches what the agent loop expects (string / JSON)

### 3. Adversarial (must-have)

Cover failure modes and misuse — tests should **expect** throws or error results:

- Missing / empty required fields
- Out-of-range values (timeouts, option counts, header length)
- Unsupported flags (`run_in_background`, nested Agent, etc.)
- Missing host callback (no CLI prompt, no spawn host)
- Permission / confirmation denied (via `ToolRegistry.execute`)
- Plan mode blocking write/shell tools
- Path edge cases (relative vs absolute, missing files)
- Legacy field aliases still accepted when documented (`timeout_ms`)

## Conventions

- Use `test-helpers.ts`: `withTempDir`, `toolContext` — tests may use OS `/tmp` via `tmpdir()`; production/runtime data must live under `~/.kako/` (see `config/paths.ts`)
- Describe blocks: `"<tool> definition"`, `"<fn>"`, `"<tool>Handler"`, `"adversarial"`
- No live LLM in unit tests; use `createMockRouter` in `*.integration.test.ts`
- Adversarial tests name the attack: `"rejects …"`, `"fails when …"`, `"does not …"`

## Checklist (copy per new tool)

```
[ ] <tool>.test.ts — schema + handler + adversarial
[ ] integration test if tool affects agent loop / CLI
[ ] Entry added to index.test.ts REQUIRED_TOOL_TESTS
[ ] Handler exports testable helpers where logic is non-trivial
[ ] pnpm --filter @kako/core test — green
```
