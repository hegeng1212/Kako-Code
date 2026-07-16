# Per-cwd Workspace Security Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist workspace capability / outsidePolicy / extraTrustedRoots per Project cwd, with lazy migrate from global `security.json`.

**Architecture:** Optional `Project.security` overlay on `projects.json`. `loadSecurityPolicy(cwd)` merges global base + project overlay + cwd-normalized roots. Settings GET/PUT take `cwd`; PUT writes only Project.security.

**Tech Stack:** TypeScript, vitest, Hono server, React settings UI.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-14-per-cwd-workspace-security-design.md`
- Scope A only: capability, outsidePolicy, extraTrustedRoots
- Network stays global
- No per-session override within same cwd
- Engineering principles: no keyword guards

## File Map

| File | Responsibility |
|------|----------------|
| `packages/shared/src/session.ts` | `ProjectWorkspaceSecurity` + `Project.security` |
| `packages/core/src/session/manager.ts` | read/write/migrate project.security |
| `packages/core/src/security/policy-store.ts` | load overlay; save workspace settings to project |
| `packages/server/src/index.ts` | GET/PUT `/api/security` with cwd |
| `apps/web/src/api.ts` + `SecuritySettingsTab.tsx` | pass/display cwd |
| Tests | `policy-store.test.ts`, manager tests as needed |

---

### Task 1: Types + Project.security persistence helpers

**Files:**
- Modify: `packages/shared/src/session.ts`
- Modify: `packages/core/src/session/manager.ts`
- Modify: `packages/core/src/session/manager.test.ts`

**Interfaces:**
- Produces:
  - `ProjectWorkspaceSecurity`
  - `sessionManager.findProject(cwd)` (existing)
  - `sessionManager.getProjectSecurity(cwd): Promise<ProjectWorkspaceSecurity | null>`
  - `sessionManager.setProjectSecurity(cwd, security: ProjectWorkspaceSecurity): Promise<Project>`
  - `sessionManager.ensureProjectSecurity(cwd, seed: ProjectWorkspaceSecurity): Promise<ProjectWorkspaceSecurity>` — if missing, write seed and return it

- [ ] Implement types + helpers + tests for set/get isolation across two cwds
- [ ] Skip commit unless user asks

---

### Task 2: loadSecurityPolicy overlay + settings save

**Files:**
- Modify: `packages/core/src/security/policy-store.ts`
- Modify: `packages/core/src/security/policy-store.test.ts`

**Interfaces:**
- `loadSecurityPolicy(cwd)` — overlay + lazy migrate via ensureProjectSecurity when project exists (or after ensure via sessionManager.resolve? Spec: no project → global only; if project exists migrate)
- Spec: first load for project with missing security migrates — need getOrCreate vs find. Spec says: "If Project exists and security missing → migrate". "If none exists yet, global only". So use `findProject`, not resolve (resolve creates). For Settings PUT: ensure project exists then set security.
- `saveWorkspaceSecuritySettings(cwd, patch: SecurityConfigFile): Promise<SecurityPolicy>` — writes Project.security only; returns loaded policy
- `applySecuritySettingsPatch` still used to shape in-memory before setProjectSecurity

- [ ] TDD: two cwds distinct capabilities; lazy migrate; PUT-like save doesn't update global workspace fields
- [ ] Skip commit unless user asks

---

### Task 3: Server + Web UI cwd

**Files:**
- Modify: `packages/server/src/index.ts`
- Modify: `apps/web/src/api.ts`
- Modify: `apps/web/src/components/SecuritySettingsTab.tsx`
- Optional: CLI open URL with `?cwd=` when known

- [ ] GET/PUT honor `cwd` query (PUT also body.cwd)
- [ ] UI reads `cwd` from `URLSearchParams`, shows path, passes to API
- [ ] Skip commit unless user asks

---

### Task 4: Verification

- [ ] Run policy-store + manager tests
- [ ] Spec coverage self-check
