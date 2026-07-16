import { describe, expect, it } from "vitest";
import type { BackgroundTask } from "../background/types.js";
import type { WorkflowRunRecord } from "../workflows/store.js";
import {
  liveWorkflowTaskActive,
  shouldRenderWorkflowFooter,
} from "./workflow-live.js";

function run(patch: Partial<WorkflowRunRecord> = {}): WorkflowRunRecord {
  return {
    taskId: "wef2ca2b8",
    runId: "wf_1",
    name: "deep-research",
    description: "research",
    status: "running",
    scriptPath: "/tmp/a.js",
    transcriptDir: "/tmp/t",
    startedAt: new Date().toISOString(),
    agentsTotal: 69,
    agentsDone: 47,
    agentsFailed: 0,
    ...patch,
  };
}

function task(patch: Partial<BackgroundTask> = {}): BackgroundTask {
  return {
    id: "wef2ca2b8",
    sessionId: "sess-1",
    kind: "workflow",
    startedAt: new Date().toISOString(),
    stopped: false,
    abort: () => {},
    ...patch,
  };
}

describe("workflow-live", () => {
  it("shows footer only when disk run is active and live task matches", () => {
    expect(shouldRenderWorkflowFooter(run(), task())).toBe(true);
    expect(shouldRenderWorkflowFooter(run({ status: "completed" }), task())).toBe(false);
    expect(shouldRenderWorkflowFooter(run(), undefined)).toBe(false);
    expect(shouldRenderWorkflowFooter(run(), task({ stopped: true }))).toBe(false);
    expect(shouldRenderWorkflowFooter(run(), task({ kind: "agent" }))).toBe(false);
    expect(shouldRenderWorkflowFooter(run(), task({ id: "other" }))).toBe(false);
  });

  it("detects active live workflow tasks", () => {
    expect(liveWorkflowTaskActive(task())).toBe(true);
    expect(liveWorkflowTaskActive(undefined)).toBe(false);
    expect(liveWorkflowTaskActive(task({ stopped: true }))).toBe(false);
  });
});
