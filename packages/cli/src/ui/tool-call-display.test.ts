import { describe, expect, it } from "vitest";
import { ansi, stripAnsi } from "./ansi.js";
import {
  collectActivityStats,
  fileToolContentIndent,
  renderActivitySummaryLine,
  renderPlanPreviewHint,
  renderSkillToolLines,
  renderToolCallErrorLines,
  renderToolCallStatusLine,
  renderToolInvocationLine,
  renderToolOutputLines,
  renderWorkflowToolLines,
  renderAgentToolLines,
  renderWorkflowFinishedEventLine,
  type ToolCallTimelineEntry,
} from "./tool-call-display.js";
import { toolCallStatPhrase } from "./tool-call-phrases.js";

function entry(overrides: Partial<ToolCallTimelineEntry> = {}): ToolCallTimelineEntry {
  return {
    type: "tool",
    id: "tool-1",
    name: "mcp/babytree/bbt_pregnancy.find_baby",
    detail: "{}",
    status: "waiting",
    dotFrame: 0,
    ...overrides,
  };
}

describe("tool-call-display", () => {
  it("renders waiting state with contextual phrase", () => {
    expect(stripAnsi(renderToolCallStatusLine(entry({ dotFrame: 0 })))).toBe(
      "Waiting Calling bbt_pregnancy.find_baby",
    );
    expect(
      stripAnsi(
        renderToolCallStatusLine(
          entry({ name: "Read", detail: "/tmp/a.md", dotFrame: 2 }),
        ),
      ),
    ).toBe("Waiting.. Reading /tmp/a.md");
  });

  it("renders dynamic workflow skills like Skill(name)", () => {
    const collapsed = stripAnsi(
      renderWorkflowToolLines(
        entry({
          name: "Workflow",
          detail: "deep-research",
          status: "success",
        }),
      ).join("\n"),
    );
    expect(collapsed).toContain("Skill(deep-research)");
    expect(collapsed).toContain("(click to expand)");
    expect(collapsed).not.toContain("Successfully loaded skill");

    const expanded = stripAnsi(
      renderWorkflowToolLines(
        entry({
          name: "Workflow",
          detail: "deep-research",
          status: "success",
          skillExpanded: true,
        }),
      ).join("\n"),
    );
    expect(expanded).toContain("Skill(deep-research)");
    expect(expanded).toContain("Successfully loaded skill");
    expect(expanded).not.toContain("/workflows");
  });

  it("renders workflow waiting with /workflows hint", () => {
    const text = stripAnsi(
      renderWorkflowToolLines(
        entry({
          name: "Workflow",
          detail: "custom-report",
          status: "waiting",
        }),
      ).join("\n"),
    );
    expect(text).toContain("Workflow(custom-report)");
    expect(text).toContain("/workflows");
    expect(text).toContain("to view dynamic workflow runs");
    expect(text).not.toContain("Approve?");
    expect(text).not.toContain("(y/n)");
    expect(text).not.toContain("Completed in 0s");
  });

  it("renders workflow success collapsed with expand hint", () => {
    const text = stripAnsi(
      renderWorkflowToolLines(
        entry({
          name: "Workflow",
          detail: "custom-report",
          status: "success",
        }),
      ).join("\n"),
    );
    expect(text).toContain("Workflow(custom-report)");
    expect(text).toContain("(click to expand)");
    expect(text).not.toContain("/workflows");
  });

  it("renders workflow success expanded with /workflows hint", () => {
    const text = stripAnsi(
      renderWorkflowToolLines(
        entry({
          name: "Workflow",
          detail: "custom-report",
          status: "success",
          skillExpanded: true,
        }),
      ).join("\n"),
    );
    expect(text).toContain("/workflows");
    expect(text).not.toContain("Completed in 0s");
  });

  it("renders workflow error with header and detail", () => {
    const text = stripAnsi(
      renderWorkflowToolLines(
        entry({
          name: "Workflow",
          detail: "custom-report",
          status: "error",
          errorDetail: "Workflow template not found: custom-report",
        }),
      ).join("\n"),
    );
    expect(text).toContain("Workflow(custom-report)");
    expect(text).toContain("Workflow template not found: custom-report");
  });

  it("renders approval prompt for confirmation-gated tools", () => {
    const text = stripAnsi(
      renderToolCallStatusLine(
        entry({
          name: "Write",
          detail: "/Users/hegeng/PRD.md",
          awaitingApproval: true,
        }),
      ),
    );
    expect(text).toContain("Approve?");
    expect(text).toContain("Write /Users/hegeng/PRD.md");
    expect(text).not.toContain("(y/n)");
  });

  it("renders plan write as Updated plan", () => {
    const text = stripAnsi(
      renderToolCallStatusLine(
        entry({
          name: "Write",
          detail: "/Users/me/.kako/plans/sess.md",
          status: "success",
        }),
      ),
    );
    expect(text).toContain("⏺");
    expect(text).toContain("Updated plan");
  });

  it("merges duplicate read stats in activity collection", () => {
    expect(
      collectActivityStats([
        entry({ name: "Read", detail: "a.md", status: "success" }),
        entry({ name: "Read", detail: "b.md", status: "success" }),
        entry({ name: "Bash", detail: "ls -la", status: "success", output: "drwxr-xr-x  3 user  staff  96 .\n" }),
      ]),
    ).toEqual(["read 2 files", "listed 1 directory"]);
  });

  it("renders activity summary with thought time and stats", () => {
    const text = stripAnsi(renderActivitySummaryLine(10, ["listed 1 directory"], false));
    expect(text).toBe("Thought for 10s, listed 1 directory ▸ (click to expand)");
  });

  it("shows green approval dot on first-level summary when approved and succeeded", () => {
    const text = stripAnsi(
      renderActivitySummaryLine(
        undefined,
        ["wrote 1 file"],
        false,
        [entry({ name: "Write", detail: "/tmp/a.py", status: "success", approvalRequired: true, approvalGranted: true })],
      ),
    );
    expect(text).toContain("⏺");
    expect(text).toContain("wrote 1 file");
  });

  it("shows red approval dot when user denied", () => {
    const rendered = renderActivitySummaryLine(
      undefined,
      ["ran python3 a.py"],
      false,
      [entry({ name: "Bash", detail: "python3 a.py", status: "error", approvalRequired: true, approvalGranted: false })],
    );
    expect(rendered).toContain(ansi.red);
    expect(stripAnsi(rendered)).toContain("⏺");
  });

  it("omits approval dot when tool did not require approval", () => {
    const text = stripAnsi(
      renderActivitySummaryLine(
        undefined,
        ["read 1 file"],
        false,
        [entry({ name: "Read", detail: "/tmp/a.md", status: "success" })],
      ),
    );
    expect(text).not.toContain("⏺");
  });

  it("aligns file tool content indent with approval prefix", () => {
    expect(fileToolContentIndent({ approvalRequired: true }, 4)).toBe(7);
    expect(fileToolContentIndent({ approvalRequired: false }, 4)).toBe(4);
  });

  it("renders expanded tool invocation with output", () => {
    const bash = entry({
      name: "Bash",
      detail: "ls -la /tmp",
      status: "success",
      output: "total 0\ndrwxr-xr-x  3 user  staff  96 Jul  1 11:15 .",
    });
    expect(stripAnsi(renderToolInvocationLine(bash))).toBe("Bash(ls -la /tmp)");
    const lines = renderToolOutputLines(bash, 80);
    expect(lines.length).toBeGreaterThan(0);
    expect(stripAnsi(lines[0]!)).toContain("total 0");
  });

  it("collects activity stats excluding plan writes", () => {
    const stats = collectActivityStats([
      entry({ name: "Bash", detail: "ls -la", status: "success", output: "drwx\n" }),
      entry({
        name: "Write",
        detail: "/Users/me/.kako/plans/sess.md",
        status: "success",
      }),
    ]);
    expect(stats).toEqual(["listed 1 directory"]);
  });

  it("renders plan preview hint", () => {
    expect(stripAnsi(renderPlanPreviewHint())).toContain("/plan to preview");
  });

  it("renders failed MCP tool with neutral label and expand hint", () => {
    const text = stripAnsi(
      renderToolCallStatusLine(
        entry({
          name: "mcp/babytree/bbt_tool.save_growth_records",
          detail: "{}",
          status: "error",
          errorDetail: "MCP error -32602: data/record_id must be string",
          errorExpanded: false,
        }),
      ),
    );
    expect(text).toContain("⏺");
    expect(text).toContain("called bbt_tool.save_growth_records");
    expect(text).not.toContain("Failed to call");
    expect(text).toContain("(click to expand)");
  });

  it("renders successful MCP tool with green dot and neutral label", () => {
    const text = stripAnsi(
      renderToolCallStatusLine(
        entry({
          status: "success",
        }),
      ),
    );
    expect(text).toContain("⏺");
    expect(text).toContain("called bbt_pregnancy.find_baby");
  });

  it("renders skill tool collapsed as Skill(name)", () => {
    const text = stripAnsi(
      renderSkillToolLines(
        entry({
          name: "Skill",
          detail: "baby-growth-record",
          status: "success",
        }),
      ).join("\n"),
    );
    expect(text).toContain("Skill(baby-growth-record)");
    expect(text).toContain("(click to expand)");
    expect(text).not.toContain("Successfully loaded skill");
  });

  it("renders expanded skill with loaded message", () => {
    const text = stripAnsi(
      renderSkillToolLines(
        entry({
          name: "Skill",
          detail: "baby-growth-record",
          status: "success",
          skillExpanded: true,
        }),
      ).join("\n"),
    );
    expect(text).toContain("Skill(baby-growth-record)");
    expect(text).toContain("Successfully loaded skill");
  });

  it("renders failed state with expand hint", () => {
    const text = stripAnsi(
      renderToolCallStatusLine(
        entry({
          name: "Bash",
          detail: "curl example.com",
          status: "error",
          errorDetail: "connection refused",
          errorExpanded: false,
        }),
      ),
    );
    expect(text).toContain("⏺");
    expect(text).toContain("ran 1 shell command");
    expect(text).not.toContain("Failed to run");
    expect(text).toContain("(click to expand)");
  });

  it("renders expanded error lines", () => {
    const lines = renderToolCallErrorLines(
      entry({ status: "error", errorDetail: "boom", errorExpanded: true }),
      80,
    );
    expect(lines).toHaveLength(1);
    expect(stripAnsi(lines[0]!)).toContain("boom");
  });
});

describe("toolCallStatPhrase", () => {
  it("maps ls to listed N directories", () => {
    expect(
      toolCallStatPhrase(
        "Bash",
        "ls -la /tmp",
        "drwxr-xr-x  3 user  staff  96 .\ndrwxr-xr-x  5 user  staff  160 ..\ndrwxr-xr-x  2 user  staff  64 subdir",
      ),
    ).toBe("listed 1 directory");
  });

  it("returns null for plan file writes", () => {
    expect(
      toolCallStatPhrase("Write", "/Users/me/.kako/plans/abc.md", "plan body"),
    ).toBeNull();
  });

  it("aggregates execution bash into shell command stat", () => {
    expect(
      collectActivityStats([
        entry({ name: "Bash", detail: "python3 a.py", status: "success", output: "ok" }),
        entry({ name: "Bash", detail: "node run.js", status: "success", output: "done" }),
      ]),
    ).toEqual(["ran 2 shell commands"]);
  });

  it("renders Agent tool with subagent type and background hint", () => {
    const text = stripAnsi(
      renderAgentToolLines(
        entry({
          name: "Agent",
          detail: '{"description":"Option A scan"}',
          status: "success",
          backgrounded: true,
          toolInput: {
            subagent_type: "explore",
            description: "Option A scan",
            run_in_background: true,
          },
        }),
      ).join("\n"),
    );
    expect(text).toContain("Explore(Option A scan)");
    expect(text).toContain("Backgrounded agent");
  });

  it("renders workflow finished event with tree prefix", () => {
    const text = stripAnsi(
      renderWorkflowFinishedEventLine({
        taskId: "wf-1",
        runId: "run-1",
        name: "deep-research",
        description: "Deep research harness",
        status: "completed",
        startedAt: new Date(Date.now() - 732_000).toISOString(),
        completedAt: new Date().toISOString(),
        transcriptDir: "/tmp/wf",
      }),
    );
    expect(text).toMatch(/^└ Dynamic workflow "Deep research harness" completed · /);
  });
});
