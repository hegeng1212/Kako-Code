import { describe, expect, it } from "vitest";
import { ansi, stripAnsi } from "./ansi.js";
import {
  collectActivityStats,
  fileToolContentIndent,
  renderActivitySummaryLine,
  renderMcpToolLines,
  renderPlanPreviewHint,
  renderSkillToolLines,
  renderToolCallErrorLines,
  renderToolCallStatusLine,
  renderToolInvocationLine,
  renderToolOutputLines,
  renderWorkflowToolLines,
  renderWorkflowViewHintLine,
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

  it("renders dynamic workflow tool expanded by default with /workflows hint", () => {
    const expanded = stripAnsi(
      renderWorkflowToolLines(
        entry({
          name: "Workflow",
          detail: "deep-research",
          status: "success",
        }),
      ).join("\n"),
    );
    expect(expanded).toContain("Workflow(dynamic workflow: deep-research)");
    expect(expanded).toContain("/workflows");
    expect(expanded).toContain("to view dynamic workflow runs");
    expect(expanded).not.toContain("(click to expand)");
    expect(expanded).not.toContain("Skill(deep-research)");
    expect(expanded).not.toContain("Successfully loaded skill");

    const collapsed = stripAnsi(
      renderWorkflowToolLines(
        entry({
          name: "Workflow",
          detail: "deep-research",
          status: "success",
          skillExpanded: false,
        }),
      ).join("\n"),
    );
    expect(collapsed).toContain("Workflow(dynamic workflow: deep-research)");
    expect(collapsed).toContain("(click to expand)");
    expect(collapsed).not.toContain("to view dynamic workflow runs");
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

  it("renders workflow success expanded by default with /workflows hint", () => {
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
    expect(text).toContain("/workflows");
    expect(text).not.toContain("(click to expand)");
  });

  it("renders workflow success collapsed when skillExpanded is false", () => {
    const text = stripAnsi(
      renderWorkflowToolLines(
        entry({
          name: "Workflow",
          detail: "custom-report",
          status: "success",
          skillExpanded: false,
        }),
      ).join("\n"),
    );
    expect(text).toContain("Workflow(custom-report)");
    expect(text).toContain("(click to expand)");
    expect(text).not.toContain("/workflows");
  });

  it("colors /workflows blue and trailing copy muted", () => {
    const line = renderWorkflowViewHintLine();
    expect(line).toContain(`${ansi.blue}/workflows${ansi.reset}`);
    expect(line).toContain(`${ansi.muted}to view dynamic workflow runs${ansi.reset}`);
    expect(stripAnsi(line)).toBe("└ /workflows to view dynamic workflow runs");
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

  it("truncates long activity summary stats with an ellipsis", () => {
    const text = stripAnsi(
      renderActivitySummaryLine(
        undefined,
        [
          "found 47 matches",
          "read 16 files",
          "found 54 files",
          "found 120 files",
          "found 81 files",
        ],
        false,
      ),
    );
    expect(text).toBe(
      "found 47 matches, read 16 files, found 54 files, … ▸ (click to expand)",
    );
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

  it("shows Read invocation with line range when offset/limit are set", () => {
    const read = entry({
      name: "Read",
      detail: "/tmp/a.go",
      status: "success",
      toolInput: { file_path: "/tmp/a.go", offset: 34, limit: 23 },
    });
    expect(stripAnsi(renderToolInvocationLine(read))).toBe("Read(/tmp/a.go L34 - L56)");
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

  it("renders failed MCP tool with Tool() label and failure child", () => {
    const text = stripAnsi(
      renderMcpToolLines(
        entry({
          name: "mcp/babytree/bbt_tool.save_growth_records",
          detail: "{}",
          status: "error",
          errorDetail: "MCP error -32602: data/record_id must be string",
          errorExpanded: false,
        }),
      ).join("\n"),
    );
    expect(text).toContain("⏺");
    expect(text).toContain("Tool(bbt_tool.save_growth_records)");
    expect(text).toContain("Tool execution failed");
    expect(text).not.toContain("called bbt_tool");
    expect(text).not.toContain("Failed to call");
  });

  it("renders successful MCP tool with Tool() label and success child", () => {
    const text = stripAnsi(
      renderMcpToolLines(
        entry({
          name: "mcp/babytree/bbt_pregnancy.find_baby",
          status: "success",
        }),
      ).join("\n"),
    );
    expect(text).toContain("⏺");
    expect(text).toContain("Tool(bbt_pregnancy.find_baby)");
    expect(text).toContain("Successfully called tool");
    expect(text).not.toContain("called bbt_pregnancy");
  });

  it("renders waiting MCP as blinking gray dot + Tool() without Waiting text", () => {
    const on = renderMcpToolLines(
      entry({
        name: "mcp/babytree/bbt_tool.save_growth_records",
        status: "waiting",
        dotFrame: 0,
      }),
    );
    const off = renderMcpToolLines(
      entry({
        name: "mcp/babytree/bbt_tool.save_growth_records",
        status: "waiting",
        dotFrame: 3,
      }),
    );
    expect(stripAnsi(on.join("\n"))).toBe("⏺ Tool(bbt_tool.save_growth_records)");
    expect(stripAnsi(off.join("\n"))).toBe("  Tool(bbt_tool.save_growth_records)");
    expect(on.join("\n")).toContain(ansi.muted);
    expect(on.join("\n")).not.toContain("Waiting");
    expect(off.join("\n")).not.toContain("Waiting");
    expect(on.join("\n")).not.toContain("Successfully called");
  });

  it("renders waiting Skill as blinking gray dot + Skill() without Waiting text", () => {
    const text = stripAnsi(
      renderSkillToolLines(
        entry({
          name: "Skill",
          detail: "baby-growth-record",
          status: "waiting",
          dotFrame: 0,
        }),
      ).join("\n"),
    );
    expect(text).toBe("⏺ Skill(baby-growth-record)");
    expect(text).not.toContain("Waiting");
  });

  it("renders skill tool expanded by default with Successfully loaded skill", () => {
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
    expect(text).toContain("Successfully loaded skill");
    expect(text).not.toContain("(click to expand)");
  });

  it("renders skill collapsed when skillExpanded is false", () => {
    const text = stripAnsi(
      renderSkillToolLines(
        entry({
          name: "Skill",
          detail: "baby-growth-record",
          status: "success",
          skillExpanded: false,
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

  it("collapses foreground Agent success to Done summary (no result body)", () => {
    const now = Date.parse("2026-07-14T00:00:49.000Z");
    const rendered = renderAgentToolLines(
      entry({
        name: "Agent",
        detail: "explore APIs",
        status: "success",
        agentExpanded: false,
        startedAt: Date.parse("2026-07-14T00:00:00.000Z"),
        endedAt: now,
        outputTokens: 0,
        toolInput: {
          subagent_type: "explore",
          description: "explore APIs",
        },
        childTools: [
          entry({ name: "Read", detail: "a.ts", status: "success" }),
          entry({ name: "Bash", detail: "grep x", status: "success" }),
        ],
      }),
    );
    const lines = rendered.map((l) => stripAnsi(l));
    expect(lines[0]).toContain("Explore(explore APIs)");
    expect(lines[1]).toMatch(/^└ Done \(2 tool uses · 0 tokens · 49s\)$/);
    expect(rendered[1]).toContain(ansi.text);
    expect(lines.some((l) => l.includes("Read("))).toBe(false);
  });

  it("keeps expanded Explore child tools muted gray", () => {
    const rendered = renderAgentToolLines(
      entry({
        name: "Agent",
        detail: "explore APIs",
        status: "success",
        agentExpanded: true,
        toolInput: { subagent_type: "explore", description: "explore APIs" },
        childTools: [entry({ name: "Read", detail: "a.ts", status: "success" })],
      }),
    );
    const child = rendered.find((l) => stripAnsi(l).includes("Read("));
    expect(child).toBeDefined();
    expect(child!).toContain(ansi.muted);
    expect(stripAnsi(child!)).toMatch(/^└ /);
  });

  it("expands Done Agent to muted child tools without dumping agent output", () => {
    const lines = renderAgentToolLines(
      entry({
        name: "Agent",
        detail: "explore APIs",
        status: "success",
        agentExpanded: true,
        output: "LONG AGENT REPORT that must not appear",
        toolInput: {
          subagent_type: "explore",
          description: "explore APIs",
        },
        childTools: [
          entry({ name: "Read", detail: "a.ts", status: "success" }),
          entry({ name: "Bash", detail: "grep x", status: "success" }),
        ],
      }),
    ).map((l) => stripAnsi(l));
    expect(lines.some((l) => l.includes("Read(") && l.includes("a.ts"))).toBe(true);
    expect(lines.some((l) => /Bash\(/.test(l))).toBe(true);
    expect(lines.join("\n")).not.toContain("LONG AGENT REPORT");
    expect(lines.some((l) => l.includes("Done ("))).toBe(false);
  });

  it("renders waiting foreground Agent as Explore header plus Initializing ctrl+b hint", () => {
    const lines = renderAgentToolLines(
      entry({
        name: "Agent",
        detail: "查找LLM调用实现",
        status: "waiting",
        dotFrame: 1,
        toolInput: {
          subagent_type: "Explore",
          description: "查找LLM调用实现",
          run_in_background: false,
        },
      }),
    ).map((l) => stripAnsi(l));
    expect(lines[0]).toContain("Explore(查找LLM调用实现)");
    expect(lines[1]).toMatch(/Initializing… \(ctrl\+b to run in background\)/);
  });

  it("nests child tools under Explore while running", () => {
    const waiting = entry({
      name: "Agent",
      detail: "查找LLM调用实现",
      status: "waiting",
      agentExpanded: true,
      toolInput: { subagent_type: "Explore", description: "查找LLM调用实现" },
      childTools: [
        entry({ name: "Read", detail: "app/api/pkg/llm.go", status: "success" }),
        entry({ name: "Bash", detail: "grep -R openai", status: "waiting", dotFrame: 2 }),
      ],
    });
    const expandedRaw = renderAgentToolLines(waiting);
    const expanded = expandedRaw.map((l) => stripAnsi(l));
    expect(expanded[0]).toContain("Explore(查找LLM调用实现)");
    expect(expanded.some((l) => l.includes("Read(") && l.includes("llm.go"))).toBe(true);
    expect(expanded.some((l) => /Bash\(/.test(l))).toBe(true);
    expect(expanded.some((l) => l.includes("Running..."))).toBe(true);
    expect(expanded.some((l) => l.includes("ctrl+b to run in background"))).toBe(true);
    // Live children (including completed) are white; only ctrl+b hint is muted.
    const readLine = expandedRaw.find((l) => stripAnsi(l).includes("Read("));
    const ctrlB = expandedRaw.find((l) => stripAnsi(l).includes("ctrl+b"));
    expect(readLine).toContain(ansi.text);
    expect(ctrlB).toContain(ansi.muted);

    const collapsed = renderAgentToolLines({ ...waiting, agentExpanded: false }).map((l) =>
      stripAnsi(l),
    );
    expect(collapsed.some((l) => l.includes("… +2 tool uses") && l.includes("ctrl+b"))).toBe(true);
    expect(collapsed.some((l) => l.includes("Read("))).toBe(false);
  });

  it("does not show Failed under nested Explore child tools", () => {
    const lines = renderAgentToolLines(
      entry({
        name: "Agent",
        detail: "scan",
        status: "waiting",
        agentExpanded: true,
        toolInput: { subagent_type: "Explore", description: "scan" },
        childTools: [
          entry({ name: "Read", detail: "missing.ts", status: "error", errorDetail: "ENOENT" }),
          entry({ name: "Glob", detail: "**/*.go", status: "success" }),
        ],
      }),
    ).map((l) => stripAnsi(l));
    expect(lines.some((l) => l.includes("Read("))).toBe(true);
    expect(lines.some((l) => /Failed/i.test(l))).toBe(false);
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
