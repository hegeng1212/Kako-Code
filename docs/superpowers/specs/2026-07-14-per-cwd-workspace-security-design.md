# Per-cwd workspace security settings

**Date:** 2026-07-14  
**Status:** Implemented (see plan `docs/superpowers/plans/2026-07-14-per-cwd-workspace-security.md`)  
**Scope:** Workspace capability / outside-path policy / extra trusted roots keyed by project cwd. Network and other global security fields unchanged.

## Goal

Sessions with different working directories must not share the Settings values for:

- Session capability (`ReadOnly` | `WorkspaceWrite` | `FullAccess`)
- Outside-workspace policy (`approve` | `deny` | `allow`)
- Extra trusted roots

Same cwd → same Project → shared settings across sessions. Path sandbox already includes the session cwd; this change makes the **editable** policy layer also per-cwd.

## Decisions

| Topic | Choice |
|-------|--------|
| Storage | Optional `Project.security` on `~/.kako/index/projects.json` |
| Runtime merge | Global `security.json` base + Project.security overlay for the three fields above |
| Settings write | Persist only into `Project.security` (not those three into global file) |
| Settings API | Accept `cwd` (query or body); resolve project; default to server `process.cwd()` when omitted |
| Migration | Lazy: first load/save for a project copies the three fields from global into `Project.security` if missing |
| Network | Remains global (`network.json`) — out of scope |
| Session override | No per-session override within the same cwd |
| Trust gate | Unrelated: `trustedAt` stays separate from tool path policy |

## Data model

Extend shared `Project`:

```ts
export interface ProjectWorkspaceSecurity {
  capabilities?: { default: SessionCapability };
  workspace?: {
    outsidePolicy?: OutsideWorkspacePolicy;
    extraTrustedRoots?: string[];
  };
}

export interface Project {
  // ...existing fields...
  /** Per-cwd workspace security overlay (capability / outside policy / extra roots). */
  security?: ProjectWorkspaceSecurity;
}
```

`SecurityConfigFile` (API DTO) remains the settings UI shape. Responses still include `inheritedTrustedRoots` derived for the **requested cwd**.

## Load path (`loadSecurityPolicy(cwd)`)

1. Read and parse global `~/.kako/config/security.json` (or schema defaults).
2. Resolve Project for `cwd` (`projectIdFromCwd` / session manager helpers). If none exists yet, behave as today with global only (no Project write until ensure/create or first settings save).
3. If Project exists and `project.security` is missing → **lazy migrate**: copy current global `capabilities.default`, `workspace.outsidePolicy`, and `workspace.extraTrustedRoots` into `project.security`, persist projects index, then continue.
4. Overlay Project fields onto the in-memory policy (only the three decision fields).
5. `normalizeSecurityPolicy(policy, cwd)` as today: inherited roots = `defaultTrustedRoots(cwd)` (+ Kako paths); merge extra; deny roots unchanged from global unless already present.

Tool registries / agent runtime already call `loadSecurityPolicy(session.cwd)` — no call-site redesign beyond ensuring they keep using session cwd (already true).

## Save path (Settings)

`PUT /api/security`:

1. Resolve `cwd` from query/body (fallback `process.cwd()`).
2. Ensure Project exists for that cwd.
3. Apply patch into `project.security` (full replace of the three user-editable fields from the request, same as today’s settings form semantics).
4. Do **not** write capability / outsidePolicy / extraTrustedRoots back into global `security.json`.
5. Global file may still hold bash/secrets/bypass/etc.; those stay global-only and are not edited by this UI tab today.

`GET /api/security?cwd=…`:

1. `loadSecurityPolicy(cwd)` (triggers lazy migrate if needed).
2. Return `toSecuritySettingsFile(policy, cwd)`.

Web Security tab: display the active cwd (from query / opener context). Multi-session CLI opening settings should pass the **foreground session cwd**.

## Merge rules (explicit)

| Field | Source of truth after this change |
|-------|-----------------------------------|
| `capabilities.default` | Project.security (after migrate) |
| `workspace.outsidePolicy` | Project.security |
| `workspace.extraTrustedRoots` | Project.security |
| Inherited trusted roots | Computed from cwd + Kako home (not stored in Project) |
| `workspace.deniedRoots`, bash, secrets, bypass, approval.byRisk, resources | Global `security.json` only |

After migrate, changing global `security.json` for the three workspace fields **does not** propagate to already-migrated projects (isolation). Fresh projects that have never opened settings still migrate from whatever global currently holds on first touch.

## CLI / multi-session

- Session A (`cwd=/proj-a` FullAccess) and Session B (`cwd=/proj-b` ReadOnly) load different overlays.
- Switching Agents → session restores behavior only via that session’s cwd; no layout-global capability cache required beyond runtime’s existing per-turn `loadSecurityPolicy(session.cwd)`.
- ToolRegistry caches policy for the turn’s cwd; mid-session Settings changes for another project do not affect the current turn (acceptable; next turn reloads).

## Non-goals

- Per-session security different from other sessions on the same cwd
- Per-cwd network allow/deny lists
- Moving bash/secrets/bypass into Project
- Changing workspace trust (`trustedAt`) UX
- Rewriting inherited roots into Project.security

## Test plan (acceptance)

1. Two temp projects A/B: set A ReadOnly + deny outside; B FullAccess + approve — `loadSecurityPolicy` returns distinct values.
2. Lazy migrate: global FullAccess, new project first load creates `project.security` with FullAccess; later change global does not change A.
3. PUT with `cwd=A` updates only A’s Project row; B unchanged; global file lacks the three workspace fields after save (or leaves stale global unused for those fields without regressing other global keys).
4. Runtime: tool registry / session with `session.cwd=A` uses A’s capability.
5. Existing policy-store unit tests updated for overlay + migrate; no change to network-store.

## Files (expected)

| Area | Path |
|------|------|
| Types | `packages/shared/src/session.ts` (+ export if needed) |
| Policy merge / migrate | `packages/core/src/security/policy-store.ts` |
| Project read/write helpers | `packages/core/src/session/manager.ts` (or thin helper next to project-id) |
| API | `packages/server/src/index.ts` |
| UI cwd hint | `apps/web/src/components/SecuritySettingsTab.tsx` |
| Tests | `policy-store.test.ts`, possibly manager / API tests |

## Open implementation notes

- Prefer a small `getOrCreateProjectSecurity(cwd)` helper rather than duplicating migrate in GET and load.
- Absolute paths in `extraTrustedRoots` stay absolute; `$CWD` expansion continues to use the **policy load cwd**.
- Orphan Project rows (cwd moved/deleted) are out of scope; same as trust stubs today.
