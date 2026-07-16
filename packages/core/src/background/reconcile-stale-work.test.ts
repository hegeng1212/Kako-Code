import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getSessionMemoryDir } from "../config/paths.js";
import { sessionManager } from "../session/manager.js";
import { saveWorkflowRun, loadWorkflowRuns, type WorkflowRunRecord } from "../workflows/store.js";
import { reconcileStaleBackgroundWork } from "./reconcile-stale-work.js";

async function writeMeta(sessionId: string, patch: Record<string, unknown>): Promise<void> {
  const dir = getSessionMemoryDir(sessionId);
  await mkdir(dir, { recursive: true });
  const now = new Date().toISOString();
  await writeFile(
    join(dir, "meta.json"),
    JSON.stringify({
      id: sessionId,
      projectId: "proj-test",
      cwd: "/tmp/research",
      agentName: "main",
      title: "研究报告",
      status: "active",
      createdAt: now,
      updatedAt: now,
      ...patch,
    }),
    "utf-8",
  );
}

const runningRun = (runId: string, args?: unknown): WorkflowRunRecord => ({
  taskId: `w${runId}`,
  runId,
  name: "deep-research",
  description: "Deep research",
  status: "running",
  scriptPath: "/tmp/script.js",
  transcriptDir: "/tmp/transcripts",
  startedAt: new Date().toISOString(),
  args,
  agentsTotal: 2,
  agentsDone: 0,
  agentsFailed: 0,
});

describe("reconcileStaleBackgroundWork", () => {
  afterEach(() => {
    delete process.env.KAKO_HOME;
  });

  it("stops orphaned running workflow runs and demotes working agentState to blocked", async () => {
    const home = await mkdtemp(join(tmpdir(), "kako-reconcile-"));
    process.env.KAKO_HOME = home;

    const sessionId = "sess-research";
    await writeMeta(sessionId, {
      agentState: {
        state: "working",
        detail: "deep-research running",
        tempo: "active",
        since: new Date().toISOString(),
      },
    });
    await saveWorkflowRun(sessionId, runningRun("wf_research1"));

    const result = await reconcileStaleBackgroundWork();

    expect(result.stoppedRuns).toBe(1);
    expect(result.demotedSessions).toBe(1);

    const runs = await loadWorkflowRuns(sessionId);
    expect(runs[0]?.status).toBe("stopped");
    expect(runs[0]?.error).toMatch(/interrupted/i);

    const meta = await sessionManager.getSessionMeta(sessionId);
    expect(meta?.agentState?.state).toBe("blocked");
    expect(meta?.agentState?.detail).toMatch(/interrupted/i);
  });

  it("checkpoints orphaned running workflows as interrupted", async () => {
    const home = await mkdtemp(join(tmpdir(), "kako-reconcile-cp-"));
    process.env.KAKO_HOME = home;

    const sessionId = "sess-research-cp";
    await writeMeta(sessionId, {});
    await saveWorkflowRun(
      sessionId,
      runningRun("wf_research1", "投资者视角·中国辅食市场 2024-2026"),
    );

    await reconcileStaleBackgroundWork();

    const { listResumableInterrupted } = await import("./interrupted-store.js");
    const items = await listResumableInterrupted(sessionId);
    expect(items).toHaveLength(1);
    expect(items[0]?.kind).toBe("workflow");
    if (items[0]?.kind === "workflow") {
      expect(items[0].runId).toBe("wf_research1");
      expect(items[0].scriptPath).toBeTruthy();
      expect(items[0].args).toBe("投资者视角·中国辅食市场 2024-2026");
    }
  });

  it("checkpoints orphaned active agents as interrupted", async () => {
    const home = await mkdtemp(join(tmpdir(), "kako-reconcile-ag-"));
    process.env.KAKO_HOME = home;

    const sessionId = "sess-agent-cp";
    await writeMeta(sessionId, {
      agentState: {
        state: "working",
        detail: "subagent running",
        tempo: "active",
        since: new Date().toISOString(),
      },
    });
    const { upsertActiveAgentPayload } = await import("./agent-persist.js");
    await upsertActiveAgentPayload(sessionId, {
      taskId: "a1",
      description: "Explore Option A",
      prompt: "Look at Option A",
      subagentName: "explore",
      startedAt: new Date().toISOString(),
    });

    await reconcileStaleBackgroundWork();

    const { listResumableInterrupted } = await import("./interrupted-store.js");
    const items = await listResumableInterrupted(sessionId);
    expect(items).toHaveLength(1);
    expect(items[0]?.kind).toBe("agent");
    const { listActiveAgentPayloads } = await import("./agent-persist.js");
    expect(await listActiveAgentPayloads(sessionId)).toHaveLength(0);
  });

  it("demotes stale working agentState even without a workflow run", async () => {
    const home = await mkdtemp(join(tmpdir(), "kako-reconcile-"));
    process.env.KAKO_HOME = home;

    const sessionId = "sess-agent-bg";
    await writeMeta(sessionId, {
      agentState: {
        state: "working",
        detail: "subagent running",
        tempo: "active",
        since: new Date().toISOString(),
      },
    });

    const result = await reconcileStaleBackgroundWork();
    expect(result.demotedSessions).toBe(1);
    expect(result.stoppedRuns).toBe(0);

    const meta = await sessionManager.getSessionMeta(sessionId);
    expect(meta?.agentState?.state).toBe("blocked");
  });

  it("leaves done sessions and completed runs untouched", async () => {
    const home = await mkdtemp(join(tmpdir(), "kako-reconcile-"));
    process.env.KAKO_HOME = home;

    const sessionId = "sess-done";
    await writeMeta(sessionId, {
      agentState: {
        state: "done",
        detail: "finished",
        tempo: "idle",
        since: new Date().toISOString(),
      },
    });
    await saveWorkflowRun(sessionId, {
      ...runningRun("wf_done"),
      status: "completed",
      completedAt: new Date().toISOString(),
    });

    const result = await reconcileStaleBackgroundWork();
    expect(result.stoppedRuns).toBe(0);
    expect(result.demotedSessions).toBe(0);

    const meta = await sessionManager.getSessionMeta(sessionId);
    expect(meta?.agentState?.state).toBe("done");
    const runs = await loadWorkflowRuns(sessionId);
    expect(runs[0]?.status).toBe("completed");
  });

  it("demotes done agentState to blocked when an orphaned running workflow is stopped", async () => {
    const home = await mkdtemp(join(tmpdir(), "kako-reconcile-done-"));
    process.env.KAKO_HOME = home;

    const sessionId = "sess-done-orphan";
    await writeMeta(sessionId, {
      agentState: {
        state: "done",
        detail: "workflow started",
        tempo: "idle",
        since: new Date().toISOString(),
      },
    });
    await saveWorkflowRun(sessionId, runningRun("wf_orphan"));

    const result = await reconcileStaleBackgroundWork();
    expect(result.stoppedRuns).toBe(1);
    expect(result.demotedSessions).toBe(1);
    expect(result.checkpointed).toBe(1);

    const meta = await sessionManager.getSessionMeta(sessionId);
    expect(meta?.agentState?.state).toBe("blocked");
  });

  it("revives ended sessions that have interrupted checkpoints", async () => {
    const home = await mkdtemp(join(tmpdir(), "kako-reconcile-ended-"));
    process.env.KAKO_HOME = home;

    const sessionId = "sess-ended-cp";
    await writeMeta(sessionId, {
      status: "ended",
      agentState: {
        state: "done",
        detail: "quit",
        tempo: "idle",
        since: new Date().toISOString(),
      },
    });
    await saveWorkflowRun(sessionId, runningRun("wf_ended"));

    await reconcileStaleBackgroundWork();

    const meta = await sessionManager.getSessionMeta(sessionId);
    expect(meta?.status).toBe("active");
    expect(meta?.agentState?.state).toBe("blocked");
    const { listResumableInterrupted } = await import("./interrupted-store.js");
    expect(await listResumableInterrupted(sessionId)).toHaveLength(1);
  });

  it("demotes stuck working when workflow completed but never presented", async () => {
    const home = await mkdtemp(join(tmpdir(), "kako-reconcile-present-"));
    process.env.KAKO_HOME = home;

    const sessionId = "sess-completed-stuck";
    await writeMeta(sessionId, {
      agentState: {
        state: "working",
        detail: "running turn",
        tempo: "active",
        since: new Date().toISOString(),
      },
    });
    await saveWorkflowRun(sessionId, {
      ...runningRun("wf_done1"),
      status: "completed",
      completedAt: new Date().toISOString(),
      agentsDone: 2,
      result: { summary: "report ready" },
    });

    const result = await reconcileStaleBackgroundWork();
    expect(result.stoppedRuns).toBe(0);
    expect(result.demotedSessions).toBe(1);

    const meta = await sessionManager.getSessionMeta(sessionId);
    expect(meta?.agentState?.state).toBe("blocked");
    expect(meta?.agentState?.detail).toMatch(/present report/i);
  });

  it("checkpointBackgroundWorkForProcessExit drops live handles then checkpoints", async () => {
    const home = await mkdtemp(join(tmpdir(), "kako-reconcile-exit-"));
    process.env.KAKO_HOME = home;

    const sessionId = "sess-exit-live";
    await writeMeta(sessionId, {
      agentState: {
        state: "working",
        detail: "deep-research",
        tempo: "active",
        since: new Date().toISOString(),
      },
    });
    await saveWorkflowRun(sessionId, runningRun("wf_live"));

    const { registerBackgroundTask, listBackgroundTasks } = await import("./task-store.js");
    registerBackgroundTask(sessionId, "wwf_live", "workflow", async () => {});
    expect(listBackgroundTasks(sessionId).some((t) => !t.stopped)).toBe(true);

    const { checkpointBackgroundWorkForProcessExit } = await import("./reconcile-stale-work.js");
    const result = await checkpointBackgroundWorkForProcessExit();
    expect(result.checkpointed).toBeGreaterThanOrEqual(1);
    expect(listBackgroundTasks(sessionId).some((t) => !t.stopped)).toBe(false);

    const { listResumableInterrupted } = await import("./interrupted-store.js");
    expect(await listResumableInterrupted(sessionId)).toHaveLength(1);
    const meta = await sessionManager.getSessionMeta(sessionId);
    expect(meta?.agentState?.state).toBe("blocked");
  });

  it("resume then second process-exit still creates a resumable checkpoint", async () => {
    const home = await mkdtemp(join(tmpdir(), "kako-reconcile-twice-"));
    process.env.KAKO_HOME = home;

    const sessionId = "sess-twice";
    await writeMeta(sessionId, {
      agentState: {
        state: "working",
        detail: "deep-research",
        tempo: "active",
        since: new Date().toISOString(),
      },
    });

    // First launch (pre-resume): live handle + running on disk.
    await saveWorkflowRun(
      sessionId,
      runningRun("wf_first", "儿童辅食研究报告"),
    );
    const { registerWorkflowAbort } = await import("../workflows/control.js");
    const { resetBackgroundTaskStore, listBackgroundTasks } = await import("./task-store.js");
    resetBackgroundTaskStore();
    registerWorkflowAbort(sessionId, "wwf_first", "wf_first");

    const { checkpointBackgroundWorkForProcessExit } = await import("./reconcile-stale-work.js");
    const { listResumableInterrupted, removeInterruptedItem } = await import(
      "./interrupted-store.js"
    );

    await checkpointBackgroundWorkForProcessExit();
    const firstItems = await listResumableInterrupted(sessionId);
    expect(firstItems).toHaveLength(1);
    if (firstItems[0]?.kind === "workflow") {
      expect(firstItems[0].args).toBe("儿童辅食研究报告");
      await removeInterruptedItem(sessionId, firstItems[0].id);
    }

    // Soft-resume: new running run + real workflow abort registration.
    await saveWorkflowRun(sessionId, {
      ...runningRun("wf_second", "儿童辅食研究报告"),
      taskId: "wwf_second",
    });
    resetBackgroundTaskStore();
    registerWorkflowAbort(sessionId, "wwf_second", "wf_second");
    expect(listBackgroundTasks(sessionId).some((t) => !t.stopped)).toBe(true);

    // Second process exit must still checkpoint (must not stamp Stopped by user first).
    await checkpointBackgroundWorkForProcessExit();
    const secondItems = await listResumableInterrupted(sessionId);
    expect(secondItems).toHaveLength(1);
    if (secondItems[0]?.kind === "workflow") {
      expect(secondItems[0].runId).toBe("wf_second");
      expect(secondItems[0].args).toBe("儿童辅食研究报告");
    }
    const runs = await loadWorkflowRuns(sessionId);
    const second = runs.find((r) => r.runId === "wf_second");
    expect(second?.status).toBe("stopped");
    expect(second?.error).toMatch(/interrupted/i);
  });
});
