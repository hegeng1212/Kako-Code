import { describe, expect, it, vi } from "vitest";
import { adaptClaudeCodeToolText } from "../claude-code-adapt.js";
import { CLAUDE_WORKFLOW_DESCRIPTION } from "../claude-workflow-text.js";
import { workflowHandler, workflowToolDefinition, WORKFLOW_DESCRIPTION } from "./workflow.js";

vi.mock("../../workflows/runner.js", () => ({
  launchWorkflow: vi.fn(async () => ({
    taskId: "wtest1234",
    runId: "wf_test1234",
    scriptPath: "/tmp/deep-research.js",
    transcriptDir: "/tmp/transcript",
    summary: "Deep research harness",
    record: {
      taskId: "wtest1234",
      runId: "wf_test1234",
      name: "deep-research",
      description: "Deep research harness",
      status: "running",
      scriptPath: "/tmp/deep-research.js",
      transcriptDir: "/tmp/transcript",
      startedAt: new Date().toISOString(),
      agentsTotal: 0,
      agentsDone: 0,
      agentsFailed: 0,
    },
  })),
  formatWorkflowToolResult: vi.fn((launch) => `launched:${launch.runId}`),
}));

describe("Workflow tool definition", () => {
  it("matches Claude Code schema", () => {
    expect(workflowToolDefinition.name).toBe("Workflow");
    expect(workflowToolDefinition.inputSchema.$schema).toBe(
      "https://json-schema.org/draft/2020-12/schema",
    );
    expect(workflowToolDefinition.inputSchema.additionalProperties).toBe(false);
    expect(workflowToolDefinition.inputSchema.properties?.script?.maxLength).toBe(524_288);
    expect(workflowToolDefinition.inputSchema.properties?.resumeFromRunId?.pattern).toBe(
      "^wf_[a-z0-9-]{6,}$",
    );
    expect(workflowToolDefinition.requiresConfirmation).toBe(true);
  });

  it("adapts workflow paths for Kako", () => {
    expect(WORKFLOW_DESCRIPTION).toContain("/workflows");
    expect(WORKFLOW_DESCRIPTION).not.toContain(".claude/workflows/");
    expect(workflowToolDefinition.inputSchema.properties?.name?.description).toContain(
      ".kako/workflows/",
    );
  });

  it("keeps canonical Claude Code description body", () => {
    expect(adaptClaudeCodeToolText(CLAUDE_WORKFLOW_DESCRIPTION)).toBe(WORKFLOW_DESCRIPTION);
    expect(WORKFLOW_DESCRIPTION).toContain("Use /workflows to watch live progress");
    expect(WORKFLOW_DESCRIPTION).toContain("DEFAULT TO pipeline()");
  });
});

describe("workflowHandler", () => {
  it("launches named workflows in the background", async () => {
    const result = await workflowHandler(
      { name: "deep-research", args: "test question" },
      {
        agentId: "main",
        sessionId: "sess-1",
        toolUseId: "tool-1",
        cwd: "/tmp",
      },
    );
    expect(result).toBe("launched:wf_test1234");
  });
});
