import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildPlanReviewRows,
  formatPlanPathForDisplay,
  planActionFromRow,
  planReviewPanelRowCount,
  renderPlanReviewPanelLines,
} from "./plan-review.js";

describe("plan-review", () => {
  it("builds three approval options", () => {
    const rows = buildPlanReviewRows();
    expect(rows).toHaveLength(3);
    expect(rows[0]?.label).toContain("auto mode");
    expect(rows[1]?.label).toContain("manually approve");
    expect(rows[2]?.label).toContain("what to change");
  });

  it("maps rows to plan actions", () => {
    const rows = buildPlanReviewRows();
    expect(planActionFromRow(rows[0]!)).toBe("auto");
    expect(planActionFromRow(rows[1]!)).toBe("manual");
    expect(planActionFromRow(rows[2]!)).toBe("revise");
  });

  it("shortens home directory in plan path display", () => {
    const planPath = join(homedir(), ".kako", "plans", "sess.md");
    const path = formatPlanPathForDisplay(planPath);
    expect(path).toMatch(/^~\//);
    expect(path).toContain(".kako/plans/sess.md");
  });

  it("renders panel with question and path hint", () => {
    const lines = renderPlanReviewPanelLines({
      selectedIndex: 0,
      cols: 100,
      planPath: "/Users/me/.kako/plans/sess.md",
    });
    const joined = lines.join("\n");
    expect(joined).toContain("ready to execute");
    expect(joined).toContain("auto mode");
    expect(joined).toContain("ctrl+g");
  });

  it("computes footer row count", () => {
    expect(planReviewPanelRowCount(80)).toBeGreaterThan(6);
  });
});
