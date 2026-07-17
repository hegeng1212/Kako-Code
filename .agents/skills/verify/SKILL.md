---
name: verify
description: Use before claiming work is complete, opening a PR, or releasing — run the right filter build/test commands and self-check engineering red lines with command evidence.
---

# Verify before completion

Do not claim “done”, “fixed”, or “passing” without command evidence from this session.

## Commands (by blast radius)

```bash
# Shared types changed
pnpm --filter @kako/shared build

# Core
pnpm --filter @kako/core test
pnpm --filter @kako/core build

# CLI (tests + dist rebuild — manual kako uses dist/)
pnpm --filter @kako/cli test
pnpm --filter @kako/cli build

# Repo quality gates (match CI)
pnpm lint
pnpm typecheck
```

Prefer targeted vitest paths when iterating:

```bash
pnpm --filter @kako/core exec vitest run src/path/to/file.test.ts
pnpm --filter @kako/cli exec vitest run src/ui/foo.test.ts
```

Node: use `.nvmrc` (22). `engine-strict=true` requires Node >= 22.

## Red-line self-check

- [ ] Patch / enumeration logic? If yes, rewrite at prompt/tool/architecture layer.
- [ ] Session-scoped state on `AgentRuntime` (not only per-turn `ToolRegistry`)?
- [ ] Skill catalog / builtin tools completeness untouched or correctly updated?
- [ ] Docs-first: AGENTS / `.agents/skills` / spec updated for behavior changes?
- [ ] CLI rebuilt if UI or chat wiring changed?
- [ ] `pnpm lint` clean (warnings OK; errors must be zero)?

## Output

When reporting completion, cite what you ran and the pass/fail result briefly.
