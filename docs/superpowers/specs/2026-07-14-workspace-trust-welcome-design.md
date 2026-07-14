# Workspace trust + first-entry welcome

**Date:** 2026-07-14  
**Status:** Approved for implementation planning  
**Scope:** CLI first-launch trust gate for a working directory, then Claude-style welcome when trust is granted.

## Goal

When the user runs Kako in a working directory that has never been trusted, show a workspace access confirmation (Claude Code–style). If they decline, exit. If they accept, persist trust for that project cwd and enter chat with the standard two-column welcome screen.

## Decisions

| Topic | Choice |
|-------|--------|
| Trigger | Per-project cwd trust (`trustedAt`), not global “first kako ever” |
| Persistence | `Project.trustedAt` on `~/.kako` projects index |
| Decline | Exit process; do not mark trusted; do not create a session for this attempt |
| Accept | Set `trustedAt`, then start chat with **standard** welcome header (forced once) |
| Migration | Existing projects missing `trustedAt` are treated as already trusted (backfill once) |
| Security roots | Do **not** merge with `security.workspace.trustedRoots` (tool path policy) |

## Data model

Extend shared `Project`:

```ts
export interface Project {
  id: string;
  cwd: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  lastSessionId?: SessionId;
  /** ISO time when the user confirmed trust for this workspace; absent = not trusted. */
  trustedAt?: string;
}
```

Helpers (session manager / small API):

- `isProjectTrusted(project): boolean` → `Boolean(project.trustedAt)`
- `ensureProjectTrusted(cwd): Promise<Project>` — set `trustedAt` if missing
- `migrateLegacyProjectsTrust(index)` — for each project without `trustedAt`, set `trustedAt = updatedAt ?? createdAt`

`resolveProject` today auto-creates projects on first session. Trust gate must run **before** session creation:

1. Look up project by `projectIdFromCwd(cwd)` without creating, **or** create/find project but leave `trustedAt` unset until Yes.
2. Preferred: `getOrCreateProject(cwd)` may create an untrusted project row (no session yet); Yes sets `trustedAt`; No deletes the untrusted stub **or** leaves stub without `trustedAt` (acceptable). Prefer **leave stub without trustedAt** so a later Yes is a simple update; No never writes `trustedAt`.

## Startup flow (`runChat`)

Order relative to today:

1. `initializeKakoHome`
2. Provider readiness / setup guide (unchanged)
3. **NEW:** workspace trust gate for `cwd`
4. Load agent / context / usage / `ChatLayout` / session create (unchanged after gate)

Gate algorithm:

```
await migrateLegacyProjectsTrustIfNeeded()
project = await getOrCreateProject(cwd)   // may lack trustedAt
if (!project.trustedAt) {
  decision = await promptWorkspaceTrust(cwd, layout-or-raw-tty)
  if (decision !== 'trust') process.exit(0)  // or return cleanly from runChat
  await markProjectTrusted(project.id)
  forceStandardWelcome = true
} else {
  forceStandardWelcome = false
}
// continue: headerMode = forceStandardWelcome ? 'standard' : resolveChatHeaderMode(usage)
```

## Trust UI

Surface: dedicated CLI prompt (can live under `packages/cli/src/ui/workspace-trust.ts`), styled with Kako pink accents (not Claude’s yellow separator). Reuse numbered select / Enter–Esc patterns already used by tool approval or `readChoice`.

Content (English, Claude structure, Kako wording):

- Heading: `Accessing workspace:`
- Path: absolute `cwd` (bold / primary text)
- Body: short trust check — is this a project you created or trust? If not, review the folder first.
- Capability line: `Kako will be able to read, edit, and execute files here.`
- Options:
  1. `Yes, I trust this folder`
  2. `No, exit`
- Footer: `Enter to confirm · Esc to cancel` (Esc ≡ No)

Do not show the chat welcome box until Yes.

## Post-trust welcome

On Yes (and on later visits when header mode resolves to standard), use existing `renderWelcomeScreen` / `ChatLayout` standard header:

- Left: `Welcome back!`, mascot, model label, shortened cwd  
- Right: Tips / What's new  
- Title: `Kako v{version}`

Forced `standard` after a brand-new trust ensures the full box appears even if the user also launched kako elsewhere recently (would otherwise get mini header).

Subsequent launches in the same trusted cwd keep existing `resolveChatHeaderMode` idle rules.

## Non-goals

- Revoke-trust slash command (future)
- Trust ≠ auto-approve tool confirmations
- No change to MCP / Write / Bash approval policy
- Web UI trust flow out of scope

## Tests

- Unit: legacy migration backfills `trustedAt`; `isProjectTrusted` false without field
- Unit: trust prompt render contains heading, path, both options
- Integration-ish: `markProjectTrusted` persists across reload of projects index
- Chat path: untrusted → declining exits without creating session (mock prompt)

## Open implementation notes

- Whether trust prompt runs before or after `ChatLayout.start()`: prefer **before** `ChatLayout` so decline does not paint welcome; use a lightweight readline/select helper or a minimal layout mode.
- Provider setup may still run before trust (user already installing keys is fine); trust is specifically about the folder.
