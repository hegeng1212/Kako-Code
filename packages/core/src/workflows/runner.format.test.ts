import { describe, expect, it } from "vitest";
import { formatWorkflowToolResult } from "./runner.js";

describe("formatWorkflowToolResult", () => {
  it("matches Claude Code workflow launch result shape", () => {
    const text = formatWorkflowToolResult({
      taskId: "w66kf24xd",
      runId: "wf_a4ae445d",
      scriptPath: "/tmp/deep-research-wf_a4ae445d.js",
      transcriptDir: "/tmp/transcripts/wf_a4ae445d",
      summary: "Deep research harness",
      record: {
        taskId: "w66kf24xd",
        runId: "wf_a4ae445d",
        name: "deep-research",
        description: "Deep research harness",
        status: "running",
        scriptPath: "/tmp/deep-research-wf_a4ae445d.js",
        transcriptDir: "/tmp/transcripts/wf_a4ae445d",
        startedAt: new Date().toISOString(),
        agentsTotal: 0,
        agentsDone: 0,
        agentsFailed: 0,
      },
    });

    expect(text).toContain("Workflow launched in background.");
    expect(text).toContain("Task ID: w66kf24xd");
    expect(text).toContain("Run ID: wf_a4ae445d");
    expect(text).toContain(
      'To resume after editing the script: Workflow({scriptPath: "/tmp/deep-research-wf_a4ae445d.js", resumeFromRunId: "wf_a4ae445d"})',
    );
    expect(text).toContain("inspect journal.jsonl");
    expect(text).toContain("You will be notified when it completes. Use /workflows to watch live progress.");
    expect(text).not.toContain("Reply to the user briefly");
  });
});
