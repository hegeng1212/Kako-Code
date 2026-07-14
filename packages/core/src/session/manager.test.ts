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
});
