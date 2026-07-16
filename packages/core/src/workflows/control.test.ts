import { describe, expect, it, vi, beforeEach } from "vitest";
import { resetBackgroundTaskStore } from "../background/task-store.js";
import {
  clearWorkflowAbort,
  registerWorkflowAbort,
  stopWorkflowByTaskId,
  WorkflowStoppedError,
} from "./control.js";
import { updateWorkflowRun, loadWorkflowRuns } from "./store.js";

vi.mock("./store.js", () => ({
  updateWorkflowRun: vi.fn(async () => undefined),
  loadWorkflowRuns: vi.fn(async () => [
    {
      taskId: "wabc1234",
      runId: "wf_abc1234",
      name: "deep-research",
      description: "x",
      status: "running",
      scriptPath: "/tmp/a.js",
      transcriptDir: "/tmp/t",
      startedAt: new Date().toISOString(),
      agentsTotal: 0,
      agentsDone: 0,
      agentsFailed: 0,
    },
  ]),
}));

describe("workflow control", () => {
  beforeEach(() => {
    resetBackgroundTaskStore();
    clearWorkflowAbort("sess-1", "wabc1234");
    vi.mocked(updateWorkflowRun).mockClear();
  });

  it("registers abort controller and stops via TaskStop path", async () => {
    const controller = registerWorkflowAbort("sess-1", "wabc1234", "wf_abc1234");
    expect(controller.signal.aborted).toBe(false);

    const result = await stopWorkflowByTaskId("sess-1", "wabc1234");
    expect(result.success).toBe(true);
    expect(controller.signal.aborted).toBe(true);
    expect(updateWorkflowRun).toHaveBeenCalledWith(
      "sess-1",
      "wf_abc1234",
      expect.objectContaining({ status: "stopped", error: "Stopped by user" }),
    );
  });

  it("task.abort only signals — does not stamp Stopped by user", async () => {
    registerWorkflowAbort("sess-1", "wabc1234", "wf_abc1234");
    const { getBackgroundTask } = await import("../background/task-store.js");
    const task = getBackgroundTask("sess-1", "wabc1234");
    expect(task).toBeTruthy();
    await task!.abort();
    expect(updateWorkflowRun).not.toHaveBeenCalled();
    // loadWorkflowRuns mock stays available for stop path
    expect(await loadWorkflowRuns("sess-1")).toHaveLength(1);
  });

  it("WorkflowStoppedError identifies user stop", () => {
    expect(new WorkflowStoppedError().name).toBe("WorkflowStoppedError");
  });
});
