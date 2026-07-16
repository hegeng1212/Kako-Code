import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  loadInterruptedBackground,
  upsertInterruptedItem,
  listResumableInterrupted,
  markInterruptedDiscarded,
  removeInterruptedForWorkflowRun,
  type InterruptedWorkflowItem,
} from "./interrupted-store.js";

describe("interrupted-store", () => {
  afterEach(() => {
    delete process.env.KAKO_HOME;
  });

  it("upserts workflow interrupt and lists it until discarded", async () => {
    process.env.KAKO_HOME = await mkdtemp(join(tmpdir(), "kako-int-"));
    const item: InterruptedWorkflowItem = {
      id: "cp-1",
      kind: "workflow",
      taskId: "wabc",
      runId: "wf_abc",
      name: "deep-research",
      description: "Deep research",
      scriptPath: "/tmp/a.js",
      status: "interrupted",
      createdAt: new Date().toISOString(),
      interruptedAt: new Date().toISOString(),
      agentsDone: 47,
      agentsTotal: 69,
    };
    await upsertInterruptedItem("sess-1", item);
    expect(await listResumableInterrupted("sess-1")).toHaveLength(1);
    await markInterruptedDiscarded("sess-1", "cp-1");
    expect(await listResumableInterrupted("sess-1")).toHaveLength(0);
    const file = await loadInterruptedBackground("sess-1");
    expect(file.items[0]?.status).toBe("discarded");
  });

  it("removeInterruptedForWorkflowRun clears checkpoints for that runId", async () => {
    process.env.KAKO_HOME = await mkdtemp(join(tmpdir(), "kako-int-rm-"));
    const item: InterruptedWorkflowItem = {
      id: "wf-wf_abc",
      kind: "workflow",
      taskId: "wabc",
      runId: "wf_abc",
      name: "deep-research",
      description: "Deep research",
      scriptPath: "/tmp/a.js",
      status: "interrupted",
      createdAt: new Date().toISOString(),
      interruptedAt: new Date().toISOString(),
    };
    await upsertInterruptedItem("sess-1", item);
    await upsertInterruptedItem("sess-1", {
      ...item,
      id: "wf-wf_other",
      runId: "wf_other",
      taskId: "wother",
    });
    await removeInterruptedForWorkflowRun("sess-1", "wf_abc");
    const left = await listResumableInterrupted("sess-1");
    expect(left).toHaveLength(1);
    expect(left[0]?.runId).toBe("wf_other");
  });
});
