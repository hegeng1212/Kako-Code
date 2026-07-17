import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hasWorkflowArgs, launchWorkflow, normalizeWorkflowArgs } from "./runner.js";

const priorHome = process.env.KAKO_HOME;
let tempHome = "";

beforeEach(async () => {
  tempHome = await mkdtemp(join(tmpdir(), "kako-resume-wf-"));
  process.env.KAKO_HOME = tempHome;
});

afterEach(async () => {
  if (priorHome === undefined) delete process.env.KAKO_HOME;
  else process.env.KAKO_HOME = priorHome;
  if (tempHome) await rm(tempHome, { recursive: true, force: true });
});

vi.mock("./registry.js", () => ({
  copyWorkflowTemplateToSession: vi.fn(),
  loadWorkflowTemplate: vi.fn(),
}));

vi.mock("./dsl/sandbox.js", () => ({
  executeWorkflowScript: vi.fn(async () => ({ ok: true })),
}));

const priorRuns = vi.hoisted(() => ({
  value: [
    {
      taskId: "wold1234",
      runId: "wf_old1234",
      name: "deep-research",
      description: "Deep research harness",
      status: "running" as const,
      scriptPath: "/tmp/old.js",
      transcriptDir: "/tmp/old",
      startedAt: new Date().toISOString(),
      args: "from prior run",
      agentsTotal: 1,
      agentsDone: 0,
      agentsFailed: 0,
    },
  ],
}));

vi.mock("./store.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./store.js")>();
  return {
    ...actual,
    loadWorkflowRuns: vi.fn(async () => priorRuns.value),
    saveWorkflowRun: vi.fn(async () => {}),
    updateWorkflowRun: vi.fn(async () => undefined),
  };
});

describe("launchWorkflow resumeFromRunId", () => {
  it("rejects resume while prior run is still active", async () => {
    priorRuns.value[0]!.status = "running";
    await expect(
      launchWorkflow({
        sessionId: "sess-1",
        cwd: "/tmp",
        scriptPath: "/tmp/old.js",
        resumeFromRunId: "wf_old1234",
      }),
    ).rejects.toThrow(/Stop the prior workflow run before resuming/i);
  });

  it("inherits args from the prior run when resume omits them", async () => {
    priorRuns.value[0]!.status = "stopped";
    const { saveWorkflowRun } = await import("./store.js");
    await launchWorkflow({
      sessionId: "sess-1",
      cwd: "/tmp",
      scriptPath: "/tmp/old.js",
      resumeFromRunId: "wf_old1234",
    });
    expect(saveWorkflowRun).toHaveBeenCalledWith(
      "sess-1",
      expect.objectContaining({ args: "from prior run" }),
    );
  });
});

describe("hasWorkflowArgs", () => {
  it("treats empty string and empty object as missing", () => {
    expect(hasWorkflowArgs("")).toBe(false);
    expect(hasWorkflowArgs("  ")).toBe(false);
    expect(hasWorkflowArgs({})).toBe(false);
    expect(hasWorkflowArgs([])).toBe(false);
    expect(hasWorkflowArgs("topic")).toBe(true);
    expect(hasWorkflowArgs({ question: "x" })).toBe(true);
  });
});

describe("normalizeWorkflowArgs", () => {
  it("unwraps string, single-element string array, and query object to a string", () => {
    expect(normalizeWorkflowArgs("  Option A  ")).toBe("Option A");
    expect(normalizeWorkflowArgs(["Option A question"])).toBe("Option A question");
    expect(normalizeWorkflowArgs({ query: "Option A via query" })).toBe("Option A via query");
    expect(normalizeWorkflowArgs({ question: "Option A via question" })).toBe(
      "Option A via question",
    );
    expect(normalizeWorkflowArgs(null)).toBe("");
  });
});
