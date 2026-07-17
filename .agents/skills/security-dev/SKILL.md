---
name: security-dev
description: Use when changing packages/core/src/security, MCP/network approval policy, ToolRegistry confirm/session-allow wiring, or CLI tool-approval sessionAllowExtras that must stay aligned with the security gate.
---

# Security gate & approvals

Docs-first: update this skill before changing approval, allowlist, or session-allow contracts. Companion: `core-dev` for registry/runtime boundaries.

## Call chain (current)

`ToolRegistry.execute` → `runSecurityGate` (`src/security/pipeline.ts`) with `SecurityContext` → if `needsConfirm`, CLI `confirm` → `applySessionAllow` writes into shared `SessionToolAllows` held by `AgentRuntime.sessionToolAllowsBySession`.

## Module map

| File | Role |
|------|------|
| `pipeline.ts` | Gate orchestration: capability → risk → workspace/secret → network → MCP → approval |
| `risk-evaluator.ts`, `bash-policy.ts`, `git-policy.ts` | Risk / command policy |
| `workspace-guard.ts`, `secret-guard.ts` | Paths and denied secret paths |
| `network-guard.ts` + `config/network-store.ts` | Network targets and allowlists |
| `approval-resolver.ts` | Whether user confirmation is required |
| `policy-store.ts`, `capability.ts`, `tool-metadata.ts` | Policy and tool security metadata |
| `action-classifier.ts` + `agents/prompts/security-action-classifier.md` | LLM classifier in `bypassPermissions` (fail-closed) |
| `mcp/approval-policy.ts`, `mcp/network-access.ts` | MCP approval and server network |
| CLI `packages/cli/src/ui/tool-approval.ts` | UI → `sessionAllow` / `mcpTool` / `networkHost` / … |

## Session allow kinds

Must stay aligned between CLI `sessionAllowExtras` and registry `applySessionAllow` / gate `sessionAllowed*`:

- `writes`
- `bash-command`
- `network-host`
- `mcp-tool`
- `workspace-path`

Losing allows across turns is a bug: session bags are shared via `createSessionToolAllows` on the runtime map.

## Red lines

- Policy = capability / risk / allowlist / classifier — **not** keyword “intent” guards.
- Auto classifier unavailable → **block** (fail-closed).
- `Agent` tool skips confirm in the gate; do not invent a second security policy in the UI.
- Gate behavior changes need adjacent tests (`pipeline.*.test.ts`, policy tests, etc.).

## Verify

```bash
pnpm --filter @kako/core exec vitest run src/security src/tools/permission-scope.test.ts src/tools/registry.confirm-serial.test.ts
pnpm --filter @kako/core build
```
