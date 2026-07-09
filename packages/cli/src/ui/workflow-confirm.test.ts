import { describe, expect, it } from "vitest";
import {
  buildWorkflowConfirmChoiceRows,
  renderWorkflowPhaseSummary,
  workflowConfirmDecisionFromRow,
  workflowConfirmToggleScript,
} from "./workflow-confirm.js";

describe("workflow-confirm", () => {
  const meta = {
    name: "deep-research",
    description: "Deep research harness — fan-out web searches.",
    phases: [
      { title: "Scope", detail: "Decompose question into 5 search angles" },
      { title: "Search", detail: "5 parallel WebSearch agents" },
    ],
  };

  it("offers run, script toggle, and no options", () => {
    const rows = buildWorkflowConfirmChoiceRows({
      scriptVisible: false,
      scriptToggled: false,
      selectedIndex: 0,
    });
    expect(rows.map((row) => row.label)).toEqual([
      "Yes, run it",
      "View raw script",
      "No",
    ]);
  });

  it("shows summary toggle label after script is visible", () => {
    const rows = buildWorkflowConfirmChoiceRows({
      scriptVisible: true,
      scriptToggled: true,
      selectedIndex: 1,
    });
    expect(rows[1]?.label).toBe("View workflow summary ✔");
  });

  it("maps Yes to run with script path", () => {
    const rows = buildWorkflowConfirmChoiceRows({
      scriptVisible: false,
      scriptToggled: false,
      selectedIndex: 0,
    });
    expect(workflowConfirmDecisionFromRow(rows[0]!, "/tmp/preview.js")).toEqual({
      action: "run",
      scriptPath: "/tmp/preview.js",
    });
    expect(workflowConfirmDecisionFromRow(rows[2]!, "/tmp/preview.js")).toEqual({
      action: "cancel",
    });
  });

  it("toggles script visibility", () => {
    const next = workflowConfirmToggleScript({
      scriptVisible: false,
      scriptToggled: false,
      selectedIndex: 1,
    });
    expect(next.scriptVisible).toBe(true);
    expect(next.scriptToggled).toBe(true);
  });

  it("formats phase summary prose", () => {
    const lines = renderWorkflowPhaseSummary(meta);
    expect(lines[0]).toContain("2 phases");
    expect(lines[1]).toContain("1. Scope");
  });
});
