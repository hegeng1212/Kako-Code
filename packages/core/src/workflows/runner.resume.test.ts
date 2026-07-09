import { describe, expect, it, vi } from "vitest";
import { launchWorkflow } from "./runner.js";

vi.mock("./registry.js", () => ({
  copyWorkflowTemplateToSession: vi.fn(),
  loadWorkflowTemplate: vi.fn(),
}));

vi.mock("./dsl/sandbox.js", () => ({
  executeWorkflowScript: vi.fn(async () => ({ ok: true })),
}));

vi.mock("./store.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./store.js")>();
  return {
    ...actual,
    loadWorkflowRuns: vi.fn(async () => [
      {
        taskId: "wold1234",
        runId: "wf_old1234",
        name: "deep-research",
        description: "Deep research harness",
        status: "running",
        scriptPath: "/tmp/old.js",
        transcriptDir: "/tmp/old",
        startedAt: new Date().toISOString(),
        agentsTotal: 1,
        agentsDone: 0,
        agentsFailed: 0,
      },
    ]),
    saveWorkflowRun: vi.fn(async () => {}),
    updateWorkflowRun: vi.fn(async () => undefined),
  };
});

describe("launchWorkflow resumeFromRunId", () => {
  it("rejects resume while prior run is still active", async () => {
    await expect(
      launchWorkflow({
        sessionId: "sess-1",
        cwd: "/tmp",
        scriptPath: "/tmp/old.js",
        resumeFromRunId: "wf_old1234",
      }),
    ).rejects.toThrow(/Stop the prior workflow run before resuming/i);
  });
});
