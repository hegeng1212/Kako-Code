import { describe, expect, it, vi, beforeEach } from "vitest";
import { resetBackgroundTaskStore } from "../background/task-store.js";
import {
  clearWorkflowAbort,
  registerWorkflowAbort,
  stopWorkflowByTaskId,
  WorkflowStoppedError,
} from "./control.js";

vi.mock("./store.js", () => ({
  updateWorkflowRun: vi.fn(async () => undefined),
  loadWorkflowRuns: vi.fn(async () => []),
}));

describe("workflow control", () => {
  beforeEach(() => {
    resetBackgroundTaskStore();
    clearWorkflowAbort("sess-1", "wabc1234");
  });

  it("registers abort controller and stops via TaskStop path", async () => {
    const controller = registerWorkflowAbort("sess-1", "wabc1234", "wf_abc1234");
    expect(controller.signal.aborted).toBe(false);

    const result = await stopWorkflowByTaskId("sess-1", "wabc1234");
    expect(result.success).toBe(true);
    expect(controller.signal.aborted).toBe(true);
  });

  it("WorkflowStoppedError identifies user stop", () => {
    expect(new WorkflowStoppedError().name).toBe("WorkflowStoppedError");
  });
});
