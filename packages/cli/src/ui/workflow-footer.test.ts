import { describe, expect, it } from "vitest";
import { stripAnsi } from "./ansi.js";
import {
  renderBackgroundAgentWaitingLine,
  renderWorkflowFooterLine,
  renderWorkflowFooterLines,
  renderWorkflowWaitingLine,
} from "./workflow-footer.js";

describe("workflow-footer", () => {
  it("indents workflow footer like mode hints", () => {
    const line = renderWorkflowFooterLine(
      {
        name: "deep-research",
        description: "",
        agentsDone: 0,
        agentsTotal: 1,
        agentsFailed: 0,
        elapsedMs: 34_000,
        status: "running",
        currentPhase: "Scope",
      },
      80,
    );
    expect(stripAnsi(line).startsWith("  ◉ ")).toBe(true);
    expect(stripAnsi(line)).toContain("deep-research · 0/1 agents");
  });

  it("renders one footer line per live workflow", () => {
    const lines = renderWorkflowFooterLines(
      [
        {
          name: "deep-research",
          description: "就业",
          agentsDone: 7,
          agentsTotal: 27,
          agentsFailed: 0,
          elapsedMs: 104_000,
          status: "running",
          currentPhase: "Scope",
        },
        {
          name: "deep-research",
          description: "低空经济",
          agentsDone: 3,
          agentsTotal: 20,
          agentsFailed: 0,
          elapsedMs: 60_000,
          status: "running",
          currentPhase: "Gather",
        },
      ],
      100,
    );
    expect(lines).toHaveLength(2);
    expect(stripAnsi(lines[0]!)).toContain("7/27 agents");
    expect(stripAnsi(lines[1]!)).toContain("3/20 agents");
  });

  it("indents waiting lines for workflows and background agents", () => {
    expect(stripAnsi(renderWorkflowWaitingLine(1)).startsWith("  * ")).toBe(true);
    expect(stripAnsi(renderBackgroundAgentWaitingLine(2)).startsWith("  * ")).toBe(true);
  });

  it("uses a static ellipsis on background-agent waiting copy", () => {
    const plain = stripAnsi(renderBackgroundAgentWaitingLine(1));
    expect(plain).toContain("Waiting for 1 background agent to finish...");
    expect(plain.endsWith("...")).toBe(true);
  });
});
