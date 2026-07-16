import { describe, expect, it } from "vitest";
import { formatWorkflowRunsStatus } from "./status-summary.js";
import type { WorkflowRunRecord } from "./store.js";

function run(partial: Partial<WorkflowRunRecord> & Pick<WorkflowRunRecord, "taskId" | "runId" | "name">): WorkflowRunRecord {
  return {
    description: partial.description ?? "",
    status: partial.status ?? "running",
    scriptPath: partial.scriptPath ?? "/tmp/w.js",
    transcriptDir: partial.transcriptDir ?? "/tmp/t",
    startedAt: partial.startedAt ?? "2026-01-01T00:00:00.000Z",
    agentsTotal: partial.agentsTotal ?? 0,
    agentsDone: partial.agentsDone ?? 0,
    agentsFailed: partial.agentsFailed ?? 0,
    ...partial,
  };
}

describe("formatWorkflowRunsStatus", () => {
  it("reports empty session clearly", () => {
    expect(formatWorkflowRunsStatus([])).toBe("No workflows in this session.");
  });

  it("lists runs with task ids for this session", () => {
    const text = formatWorkflowRunsStatus([
      run({
        taskId: "wabc",
        runId: "wf_abc",
        name: "deep-research",
        status: "running",
        agentsTotal: 5,
        agentsDone: 2,
        currentPhase: "Search",
        startedAt: "2026-01-01T00:00:00.000Z",
      }),
    ]);
    expect(text).toContain("Workflows in this session:");
    expect(text).toContain("deep-research");
    expect(text).toContain("task=wabc");
    expect(text).toContain("run=wf_abc");
    expect(text).toContain("Search");
  });
});
