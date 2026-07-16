import { describe, expect, it } from "vitest";
import {
  buildWorkflowConfirmChoiceRows,
  formatWorkflowAllowCwd,
  renderWorkflowPhaseSummary,
  WORKFLOW_CONFIRM_SCRIPT_OPTION_INDEX,
  workflowConfirmDecisionFromRow,
  workflowConfirmToggleScript,
  workflowDontAskAgainLabel,
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

  it("offers run, don't-ask-again, script toggle, and no", () => {
    const rows = buildWorkflowConfirmChoiceRows(
      {
        scriptVisible: false,
        scriptToggled: false,
        selectedIndex: 0,
      },
      { workflowName: "deep-research", cwd: "/Users/me/proj" },
    );
    expect(rows.map((row) => row.label)).toEqual([
      "Yes, run it",
      workflowDontAskAgainLabel("deep-research", "/Users/me/proj"),
      "View raw script",
      "No",
    ]);
    expect(rows[2]!.optionIndex).toBe(WORKFLOW_CONFIRM_SCRIPT_OPTION_INDEX);
  });

  it("shortens home prefix in allow cwd label", () => {
    expect(formatWorkflowAllowCwd("/home/me/app", "/home/me")).toBe("~/app");
  });

  it("maps Yes and don't-ask-again to run actions", () => {
    const rows = buildWorkflowConfirmChoiceRows(
      {
        scriptVisible: false,
        scriptToggled: false,
        selectedIndex: 0,
      },
      { workflowName: "deep-research", cwd: "/tmp" },
    );
    expect(workflowConfirmDecisionFromRow(rows[0]!, "/tmp/preview.js")).toEqual({
      action: "run",
      scriptPath: "/tmp/preview.js",
    });
    expect(workflowConfirmDecisionFromRow(rows[1]!, "/tmp/preview.js")).toEqual({
      action: "run-always",
      scriptPath: "/tmp/preview.js",
    });
    expect(workflowConfirmDecisionFromRow(rows[3]!, "/tmp/preview.js")).toEqual({
      action: "cancel",
    });
  });

  it("shows summary toggle label after script is visible", () => {
    const rows = buildWorkflowConfirmChoiceRows({
      scriptVisible: true,
      scriptToggled: true,
      selectedIndex: 1,
    });
    expect(rows[WORKFLOW_CONFIRM_SCRIPT_OPTION_INDEX]?.label).toBe("View workflow summary ✔");
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
