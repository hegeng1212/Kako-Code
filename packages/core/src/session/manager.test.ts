import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getProjectsIndexPath } from "../config/paths.js";
import { projectIdFromCwd } from "./project-id.js";
import { SessionManager } from "./manager.js";

describe("SessionManager", () => {
  let home: string;
  let mgr: SessionManager;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "kako-home-"));
    process.env.KAKO_HOME = home;
    mgr = new SessionManager();
  });

  afterEach(async () => {
    delete process.env.KAKO_HOME;
    await rm(home, { recursive: true, force: true });
  });

  it("createOrReuseIdleSession reuses empty session and prunes duplicates", async () => {
    const cwd = join(home, "idle-reuse");
    const a = await mgr.createSession({ cwd, agentName: "main" });
    const b = await mgr.createSession({ cwd, agentName: "main" });
    const reused = await mgr.createOrReuseIdleSession({ cwd, agentName: "main" });
    expect(reused.id).toBe(b.id);
    expect(await mgr.getSession(a.id)).toBeNull();
    const listed = await mgr.listSessions({ cwd });
    expect(listed).toHaveLength(1);
    expect(listed[0]?.id).toBe(b.id);
  });

  it("createOrReuseIdleSession does not reuse sessions with dialogue", async () => {
    const cwd = join(home, "with-chat");
    const existing = await mgr.createSession({ cwd, agentName: "main" });
    const { FileMemoryStore, createMessage } = await import("../memory/store.js");
    const store = new FileMemoryStore(existing.id);
    await store.append(createMessage("user", "hello Option A"));
    await store.append(createMessage("assistant", "hi"));
    const next = await mgr.createOrReuseIdleSession({ cwd, agentName: "main" });
    expect(next.id).not.toBe(existing.id);
    expect(await mgr.getSession(existing.id)).not.toBeNull();
  });

  it("openChatEntrySession reuses empty idle when dialogue sessions also exist", async () => {
    const cwd = join(home, "entry-idle");
    const research = await mgr.createSession({ cwd, agentName: "main", title: "研究报告" });
    const { FileMemoryStore, createMessage } = await import("../memory/store.js");
    const store = new FileMemoryStore(research.id);
    await store.append(createMessage("user", "/deep-research write Option A report"));
    const idle = await mgr.createSession({ cwd, agentName: "main" });

    const opened = await mgr.openChatEntrySession({ cwd, agentName: "main" });
    expect(opened.id).toBe(idle.id);
    expect(await mgr.getSession(research.id)).not.toBeNull();
  });

  it("openChatEntrySession creates a new session when only dialogue exists", async () => {
    const cwd = join(home, "entry-create");
    const older = await mgr.createSession({ cwd, agentName: "main", title: "旧对话" });
    const { FileMemoryStore, createMessage } = await import("../memory/store.js");
    await new FileMemoryStore(older.id).append(createMessage("user", "hello Option A"));

    const research = await mgr.createSession({ cwd, agentName: "main", title: "研究报告" });
    await new FileMemoryStore(research.id).append(
      createMessage("user", "/deep-research write Option B report"),
    );
    await mgr.updateSession(research.id, {
      agentState: {
        state: "blocked",
        detail: "Background workflow interrupted — reopen to continue",
        tempo: "blocked",
        needs: "resume or continue",
        since: new Date().toISOString(),
      },
    });

    const opened = await mgr.openChatEntrySession({ cwd, agentName: "main" });
    expect(opened.id).not.toBe(older.id);
    expect(opened.id).not.toBe(research.id);
    expect(await mgr.getSession(older.id)).not.toBeNull();
    expect(await mgr.getSession(research.id)).not.toBeNull();
  });

  it("creates session with meta.json under cwd project", async () => {
    const cwd = join(home, "project");
    const session = await mgr.createSession({ cwd, agentName: "main" });
    expect(session.id).toMatch(/^sess-/);
    expect(session.cwd).toBe(cwd);
    const listed = await mgr.listSessions({ cwd });
    expect(listed).toHaveLength(1);
    expect(listed[0]?.id).toBe(session.id);
  });

  it("ends session and sets status ended", async () => {
    const session = await mgr.createSession({ cwd: home });
    await mgr.endSession(session.id);
    const loaded = await mgr.getSession(session.id);
    expect(loaded?.status).toBe("ended");
  });

  it("deleteSession removes the session from disk and lists", async () => {
    const session = await mgr.createSession({ cwd: home, title: "Doomed" });
    await mgr.deleteSession(session.id);
    expect(await mgr.getSession(session.id)).toBeNull();
    const metas = await mgr.listSessionMetas();
    expect(metas.find((m) => m.id === session.id)).toBeUndefined();
  });

  it("stores workspace security independently per cwd", async () => {
    const a = join(home, "proj-a");
    const b = join(home, "proj-b");
    await mgr.resolveProject(a);
    await mgr.resolveProject(b);
    await mgr.setProjectSecurity(a, {
      capabilities: { default: "ReadOnly" },
      workspace: { outsidePolicy: "deny", extraTrustedRoots: ["/a-extra"] },
    });
    await mgr.setProjectSecurity(b, {
      capabilities: { default: "FullAccess" },
      workspace: { outsidePolicy: "approve", extraTrustedRoots: [] },
    });
    expect(await mgr.getProjectSecurity(a)).toEqual({
      capabilities: { default: "ReadOnly" },
      workspace: { outsidePolicy: "deny", extraTrustedRoots: ["/a-extra"] },
    });
    expect(await mgr.getProjectSecurity(b)).toEqual({
      capabilities: { default: "FullAccess" },
      workspace: { outsidePolicy: "approve", extraTrustedRoots: [] },
    });
  });

  it("ensureProjectSecurity seeds only when project exists without security", async () => {
    const cwd = join(home, "seed-me");
    const seed = {
      capabilities: { default: "WorkspaceWrite" as const },
      workspace: { outsidePolicy: "allow" as const, extraTrustedRoots: [] as string[] },
    };
    expect(await mgr.ensureProjectSecurity(cwd, seed)).toEqual(seed);
    expect(await mgr.findProject(cwd)).toBeNull();

    await mgr.resolveProject(cwd);
    expect(await mgr.ensureProjectSecurity(cwd, seed)).toEqual(seed);
    expect(await mgr.getProjectSecurity(cwd)).toEqual(seed);

    const other = {
      capabilities: { default: "ReadOnly" as const },
      workspace: { outsidePolicy: "deny" as const, extraTrustedRoots: ["/x"] },
    };
    expect(await mgr.ensureProjectSecurity(cwd, other)).toEqual(seed);
  });

  it("persists allowedWorkflows per cwd for don't-ask-again", async () => {
    const cwd = join(home, "wf-allow");
    expect(await mgr.isWorkflowAllowedForCwd(cwd, "deep-research")).toBe(false);
    await mgr.allowWorkflowForCwd(cwd, "deep-research");
    expect(await mgr.isWorkflowAllowedForCwd(cwd, "deep-research")).toBe(true);
    expect(await mgr.isWorkflowAllowedForCwd(cwd, "other")).toBe(false);
    await mgr.allowWorkflowForCwd(cwd, "deep-research");
    const project = await mgr.findProject(cwd);
    expect(project?.allowedWorkflows).toEqual(["deep-research"]);
  });

  it("resolves the same project for the same cwd", async () => {
    const cwd = join(home, "myapp");
    const p1 = await mgr.resolveProject(cwd);
    const p2 = await mgr.resolveProject(cwd);
    expect(p1.id).toBe(p2.id);
    expect(p1.name).toBe("myapp");
  });

  it("treats missing trustedAt as untrusted until mark", async () => {
    const cwd = join(home, "app");
    const created = await mgr.resolveProject(cwd);
    expect(mgr.isProjectTrusted(created)).toBe(false);
  });

  it("migrates legacy projects missing trustedAt to trusted", async () => {
    const cwd = join(home, "legacy");
    const createdAt = "2026-01-01T00:00:00.000Z";
    const updatedAt = "2026-01-02T00:00:00.000Z";
    const indexPath = getProjectsIndexPath();
    await mkdir(dirname(indexPath), { recursive: true });
    await writeFile(
      indexPath,
      `${JSON.stringify(
        {
          version: 1,
          projects: [
            {
              id: projectIdFromCwd(cwd),
              cwd,
              name: "legacy",
              createdAt,
              updatedAt,
              lastSessionId: "sess-legacy1",
            },
          ],
        },
        null,
        2,
      )}\n`,
      "utf-8",
    );

    await mgr.ensureProjectsTrustMigrated();
    const project = await mgr.resolveProject(cwd);
    expect(mgr.isProjectTrusted(project)).toBe(true);
    expect(project.trustedAt).toBe(updatedAt);
  });

  it("does not auto-trust untrusted stubs after No / without session", async () => {
    const cwd = join(home, "declined");
    await mgr.getOrCreateProject(cwd);
    await mgr.ensureProjectsTrustMigrated();
    await mgr.ensureProjectsTrustMigrated();
    const project = await mgr.findProject(cwd);
    expect(project).not.toBeNull();
    expect(mgr.isProjectTrusted(project!)).toBe(false);
  });

  it("clears wrongly backfilled trust on stubs without sessions during migration", async () => {
    const cwd = join(home, "false-trust");
    const indexPath = getProjectsIndexPath();
    await mkdir(dirname(indexPath), { recursive: true });
    await writeFile(
      indexPath,
      `${JSON.stringify(
        {
          version: 1,
          projects: [
            {
              id: projectIdFromCwd(cwd),
              cwd,
              name: "false-trust",
              createdAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-01T00:00:00.000Z",
              trustedAt: "2026-01-01T00:00:00.000Z",
            },
          ],
        },
        null,
        2,
      )}\n`,
      "utf-8",
    );
    await mgr.ensureProjectsTrustMigrated();
    const project = await mgr.findProject(cwd);
    expect(mgr.isProjectTrusted(project!)).toBe(false);
  });

  it("markProjectTrusted persists trustedAt", async () => {
    const cwd = join(home, "fresh");
    await mgr.getOrCreateProject(cwd);
    const marked = await mgr.markProjectTrusted(cwd, new Date("2026-07-14T01:00:00.000Z"));
    expect(marked.trustedAt).toBe("2026-07-14T01:00:00.000Z");
    const again = await mgr.getOrCreateProject(cwd);
    expect(again.trustedAt).toBe(marked.trustedAt);
  });

  it("lists session metas across cwds", async () => {
    const a = join(home, "a");
    const b = join(home, "b");
    await mgr.createSession({ cwd: a, title: "Alpha" });
    await mgr.createSession({ cwd: b, title: "Beta" });
    const metas = await mgr.listSessionMetas();
    expect(metas.map((m) => m.title).sort()).toEqual(["Alpha", "Beta"]);
  });
});
