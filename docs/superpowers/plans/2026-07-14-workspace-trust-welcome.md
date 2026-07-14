# Workspace Trust + First-Entry Welcome Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On first use of Kako in an untrusted working directory, show a Claude-style workspace trust prompt; Yes persists trust and opens the standard welcome; No exits cleanly.

**Architecture:** Persist `Project.trustedAt` in `~/.kako/index/projects.json`. Before `ChatLayout` starts, `runChat` migrates legacy projects, resolves the cwd project, and if untrusted calls a pre-layout interactive trust UI. Accept → `markProjectTrusted` + force `standard` header; decline → return from `runChat` without creating a session.

**Tech Stack:** TypeScript, vitest, Node `stdin` raw mode (TTY), existing Kako pink/ansi UI primitives.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-14-workspace-trust-welcome-design.md`
- Trust is **per project cwd**, field `trustedAt?: string` (ISO)
- Legacy projects missing `trustedAt` → backfill once (`updatedAt ?? createdAt`)
- Do **not** wire into `security.workspace.trustedRoots`
- Trust prompt runs **before** `ChatLayout.start()` (no welcome flash on No)
- After brand-new trust, force `ChatHeaderMode = "standard"` once
- Copy: English, Claude structure, Kako capability wording
- Follow engineering principles: contract in types/APIs + UI; no semantic regex guards

## File Map

| File | Responsibility |
|------|----------------|
| `packages/shared/src/session.ts` | Add `trustedAt?: string` to `Project` |
| `packages/core/src/session/manager.ts` | Migration, get/create without trust, mark trusted, isTrusted helpers |
| `packages/core/src/session/manager.test.ts` | Tests for migration + trust helpers |
| `packages/core/src/index.ts` | Export any new public helpers if not only on `sessionManager` |
| `packages/cli/src/ui/workspace-trust.ts` | Render + interactive Yes/No prompt |
| `packages/cli/src/ui/workspace-trust.test.ts` | Render content tests (no TTY) |
| `packages/cli/src/commands/chat.ts` | Call gate before layout/session |

---

### Task 1: Project type + SessionManager trust API

**Files:**
- Modify: `packages/shared/src/session.ts`
- Modify: `packages/core/src/session/manager.ts`
- Modify: `packages/core/src/session/manager.test.ts`
- Modify: `packages/core/src/index.ts` (only if exporting new free functions)

**Interfaces:**
- Consumes: existing `Project`, `ProjectIndexFile`, `SessionManager`
- Produces:
  - `Project.trustedAt?: string`
  - `sessionManager.isProjectTrusted(project: Project): boolean`
  - `sessionManager.ensureProjectsTrustMigrated(): Promise<void>`
  - `sessionManager.getOrCreateProject(cwd: string): Promise<Project>` (may leave `trustedAt` unset for new projects)
  - `sessionManager.markProjectTrusted(cwd: string, at?: Date): Promise<Project>`

- [ ] **Step 1: Write failing tests** in `packages/core/src/session/manager.test.ts`

```typescript
it("treats missing trustedAt as untrusted until migration or mark", async () => {
  const cwd = join(home, "app");
  const created = await mgr.resolveProject(cwd);
  // After Task 1 change: new projects should NOT set trustedAt automatically
  expect(mgr.isProjectTrusted(created)).toBe(false);
});

it("migrates legacy projects missing trustedAt to trusted", async () => {
  const cwd = join(home, "legacy");
  // Seed projects.json without trustedAt (raw write), then:
  await mgr.ensureProjectsTrustMigrated();
  const project = await mgr.resolveProject(cwd);
  expect(mgr.isProjectTrusted(project)).toBe(true);
  expect(project.trustedAt).toBeTruthy();
});

it("markProjectTrusted persists trustedAt", async () => {
  const cwd = join(home, "fresh");
  await mgr.getOrCreateProject(cwd);
  const marked = await mgr.markProjectTrusted(cwd);
  expect(marked.trustedAt).toMatch(/^\d{4}-/);
  const again = await mgr.getOrCreateProject(cwd);
  expect(again.trustedAt).toBe(marked.trustedAt);
});
```

Adjust seeding: write `getProjectsIndexPath()` content with a project that has id/cwd/name/createdAt/updatedAt but no `trustedAt`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --dir packages/core exec vitest run src/session/manager.test.ts`

Expected: FAIL — methods / `trustedAt` behavior missing (or new projects currently trusted via implicit absence semantics until API exists).

- [ ] **Step 3: Implement shared type + manager methods**

In `packages/shared/src/session.ts`, add to `Project`:

```typescript
/** ISO time when the user confirmed trust for this workspace; absent = not trusted. */
trustedAt?: string;
```

In `packages/core/src/session/manager.ts`:

```typescript
isProjectTrusted(project: Project): boolean {
  return Boolean(project.trustedAt);
}

async ensureProjectsTrustMigrated(): Promise<void> {
  const index = await readProjectIndex();
  let changed = false;
  for (const p of index.projects) {
    if (!p.trustedAt) {
      p.trustedAt = p.updatedAt ?? p.createdAt;
      changed = true;
    }
  }
  if (changed) await writeProjectIndex(index);
}

/** Alias clarity: resolveProject creates project rows; new ones leave trustedAt unset. */
async getOrCreateProject(cwd: string): Promise<Project> {
  return this.resolveProject(cwd);
}

async markProjectTrusted(cwd: string, at = new Date()): Promise<Project> {
  const normalized = resolve(cwd);
  const id = projectIdFromCwd(normalized);
  const index = await readProjectIndex();
  let project = index.projects.find((p) => p.id === id);
  const now = at.toISOString();
  if (!project) {
    project = {
      id,
      cwd: normalized,
      name: projectNameFromCwd(normalized),
      createdAt: now,
      updatedAt: now,
      trustedAt: now,
    };
    index.projects.push(project);
  } else {
    project.trustedAt = now;
    project.updatedAt = now;
  }
  await writeProjectIndex(index);
  return project;
}
```

Update `resolveProject` so **newly created** projects omit `trustedAt`. Existing `resolveProject` that finds a row must **not** auto-trust; migration runs separately at chat start.

Important interaction: `createSession` → `resolveProject`. After this change, creating a session in an untrusted folder would still create an untrusted project. That is OK because trust gate runs first and calls `markProjectTrusted` before session create. SessionManager tests that only call `createSession` should either migrate first or call `markProjectTrusted` if they assert trust — update existing tests only if they break.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --dir packages/core exec vitest run src/session/manager.test.ts`

Expected: PASS

- [ ] **Step 5: Commit** (only if user asked to commit; otherwise stop here and continue)

```bash
git add packages/shared/src/session.ts packages/core/src/session/manager.ts packages/core/src/session/manager.test.ts
git commit -m "$(cat <<'EOF'
feat(session): persist workspace trust via Project.trustedAt

EOF
)"
```

---

### Task 2: Trust prompt UI (render + TTY select)

**Files:**
- Create: `packages/cli/src/ui/workspace-trust.ts`
- Create: `packages/cli/src/ui/workspace-trust.test.ts`

**Interfaces:**
- Consumes: `ansi`, `pink` / `pinkBold` from `ansi.js`; optional box helpers if a separator line is useful
- Produces:
  - `export type WorkspaceTrustDecision = "trust" | "exit"`
  - `export function renderWorkspaceTrustPrompt(cwd: string, selectedIndex?: number): string`
  - `export async function promptWorkspaceTrust(cwd: string): Promise<WorkspaceTrustDecision>`

- [ ] **Step 1: Write failing render tests**

```typescript
import { describe, expect, it } from "vitest";
import { stripAnsi } from "./ansi.js";
import { renderWorkspaceTrustPrompt } from "./workspace-trust.js";

describe("renderWorkspaceTrustPrompt", () => {
  it("shows accessing workspace heading, path, options, and footer", () => {
    const plain = stripAnsi(renderWorkspaceTrustPrompt("/tmp/demo-app", 0));
    expect(plain).toContain("Accessing workspace:");
    expect(plain).toContain("/tmp/demo-app");
    expect(plain).toContain("Yes, I trust this folder");
    expect(plain).toContain("No, exit");
    expect(plain).toContain("Kako will be able to read, edit, and execute files here.");
    expect(plain).toContain("Enter to confirm");
    expect(plain).toContain("Esc to cancel");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --dir packages/cli exec vitest run src/ui/workspace-trust.test.ts`

Expected: FAIL — module missing

- [ ] **Step 3: Implement render + interactive prompt**

`renderWorkspaceTrustPrompt(cwd, selectedIndex = 0)`:

- Pink/bold heading `Accessing workspace:`
- Absolute path in primary text
- Wrap short safety paragraph (trust check)
- Capability line about read/edit/execute
- Numbered options with `>` on selected index (0 = Yes, 1 = No)
- Footer muted: `Enter to confirm · Esc to cancel`

`promptWorkspaceTrust(cwd)`:

1. If stdin/stdout not TTY, return `"exit"` (safe default: do not auto-trust non-interactive runs)
2. Enable raw mode on stdin
3. Print rendered panel; on ↑/↓ or `1`/`2` or `j`/`k` update selection and redraw (clear previous lines or rewrite block)
4. Enter → return selected decision (`0` → `"trust"`, `1` → `"exit"`)
5. Esc → return `"exit"`
6. Always restore `setRawMode(false)` / remove listeners in `finally`

Keep the module self-contained; do not start `ChatLayout`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --dir packages/cli exec vitest run src/ui/workspace-trust.test.ts`

Expected: PASS

- [ ] **Step 5: Commit** (if requested)

```bash
git add packages/cli/src/ui/workspace-trust.ts packages/cli/src/ui/workspace-trust.test.ts
git commit -m "$(cat <<'EOF'
feat(cli): add workspace trust prompt UI

EOF
)"
```

---

### Task 3: Wire trust gate into `runChat`

**Files:**
- Modify: `packages/cli/src/commands/chat.ts`

**Interfaces:**
- Consumes: `sessionManager.ensureProjectsTrustMigrated`, `getOrCreateProject`, `isProjectTrusted`, `markProjectTrusted`; `promptWorkspaceTrust`; `resolveChatHeaderMode`
- Produces: early return from `runChat` on decline; forced `standard` header after fresh trust

- [ ] **Step 1: Insert gate after provider readiness, before ChatLayout**

In `runChat`, after `guideProviderSetup` / registry reload and **before** constructing `ChatLayout`:

```typescript
await sessionManager.ensureProjectsTrustMigrated();
const project = await sessionManager.getOrCreateProject(cwd);
let forceStandardWelcome = false;
if (!sessionManager.isProjectTrusted(project)) {
  const decision = await promptWorkspaceTrust(cwd);
  if (decision !== "trust") {
    return;
  }
  await sessionManager.markProjectTrusted(cwd);
  forceStandardWelcome = true;
}

const usage = await loadCliUsage();
const headerMode: ChatHeaderMode = forceStandardWelcome
  ? "standard"
  : resolveChatHeaderMode(usage);
await recordCliLaunch();

layout = new ChatLayout(welcomeOpts, footer, headerMode);
layout.setSlashInvokableSkills(await listSlashInvokableSkills(cwd));
layout.start();
// ... session create remains after layout.start as today
```

Move `loadCliUsage` / `recordCliLaunch` / layout construction to after the gate if they currently run earlier (today they run before `layout.start` around lines 108–114 — restructure so trust happens first).

Import:

```typescript
import { promptWorkspaceTrust } from "../ui/workspace-trust.js";
```

Ensure `sessionManager` is imported from `@kako/core` (already used elsewhere in chat if not — add import alongside existing core imports).

- [ ] **Step 2: Manual smoke checklist** (document in commit message / PR notes)

1. Point `KAKO_HOME` at a temp dir; `cd` to a never-seen folder; run `kako chat` → see trust prompt
2. Choose No / Esc → process exits; projects index has no `trustedAt` for that cwd (or untrusted stub)
3. Run again → Choose Yes → standard Welcome back! box appears; second launch in same cwd skips trust
4. Existing home with old projects → no trust prompt (migration)

- [ ] **Step 3: Run related unit tests**

Run:

```bash
pnpm --dir packages/core exec vitest run src/session/manager.test.ts
pnpm --dir packages/cli exec vitest run src/ui/workspace-trust.test.ts
```

Expected: PASS

- [ ] **Step 4: Commit** (if requested)

```bash
git add packages/cli/src/commands/chat.ts
git commit -m "$(cat <<'EOF'
feat(cli): require workspace trust before first chat in a folder

EOF
)"
```

---

## Spec coverage checklist

| Spec requirement | Task |
|------------------|------|
| `Project.trustedAt` | Task 1 |
| Legacy migration | Task 1 |
| New project untrusted until Yes | Task 1 |
| Trust UI copy + options | Task 2 |
| Esc / No → exit | Task 2 + 3 |
| Yes → mark trusted + standard welcome | Task 3 |
| Gate before ChatLayout | Task 3 |
| No merge with trustedRoots | (non-goal; no code) |

## Self-review notes

- No TBD placeholders in steps
- Method names consistent: `ensureProjectsTrustMigrated`, `markProjectTrusted`, `isProjectTrusted`, `getOrCreateProject`
- Non-TTY default `"exit"` avoids silent trust in CI; callers that need CI can set `trustedAt` via migration/fixture
