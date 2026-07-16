import { describe, expect, it } from "vitest";
import {
  agentResumeDecisionFromRow,
  buildAgentResumeConfirmRows,
  formatAgentResumeSummary,
} from "./agent-resume-confirm.js";

describe("agent-resume-confirm", () => {
  it("builds continue/cancel rows", () => {
    const rows = buildAgentResumeConfirmRows();
    expect(rows).toHaveLength(2);
    expect(agentResumeDecisionFromRow(rows[0]!)).toBe("continue");
    expect(agentResumeDecisionFromRow(rows[1]!)).toBe("cancel");
  });

  it("formats summary with description", () => {
    const lines = formatAgentResumeSummary({
      description: "Explore Option A",
      subagentName: "explore",
      prompt: "Look at Option A in detail",
    });
    expect(lines.some((l) => l.includes("Explore Option A"))).toBe(true);
    expect(lines.some((l) => l.includes("explore"))).toBe(true);
  });
});
