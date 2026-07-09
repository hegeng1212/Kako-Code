import { describe, expect, it } from "vitest";
import { stripAnsi } from "./ansi.js";
import { HISTORY_LABEL_COLUMN, renderHistorySeparator, renderPlanModeFooterHint } from "./input-footer.js";

describe("input-footer", () => {
  it("renders history label at fixed left offset with white rule", () => {
    const line = stripAnsi(renderHistorySeparator("History 11/12", 40));
    expect(line).toContain("History 11/12");
    expect(line.indexOf("History 11/12")).toBe(HISTORY_LABEL_COLUMN - 1);
    expect(line.slice(0, HISTORY_LABEL_COLUMN - 1)).toMatch(/^─+$/);
    expect(line).toMatch(/^─+History 11\/12─+$/);
  });

  it("renders right-aligned clear hint on the history separator", () => {
    const hint = "Esc again to clear";
    const cols = 60;
    const line = stripAnsi(renderHistorySeparator("History 36/36", cols, hint));
    expect(line).toContain("History 36/36");
    expect(line.endsWith(hint)).toBe(true);
    expect(line.length).toBe(cols);
  });

  it("renders plan mode footer hint", () => {
    expect(stripAnsi(renderPlanModeFooterHint())).toBe(
      "⏸ plan mode on (shift+tab to cycle)",
    );
  });
});
