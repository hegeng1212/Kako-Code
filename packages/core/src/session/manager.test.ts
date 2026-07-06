import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
});
