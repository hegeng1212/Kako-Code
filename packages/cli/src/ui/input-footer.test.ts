import { describe, expect, it } from "vitest";
import { stripAnsi } from "./ansi.js";
import { renderHistorySeparator, renderPlanModeFooterHint } from "./input-footer.js";

describe("input-footer", () => {
  it("renders centered history label", () => {
    const line = stripAnsi(renderHistorySeparator("History 11/12", 40));
    expect(line).toContain("History 11/12");
    expect(line).toMatch(/^─+ History 11\/12 ─+$/);
  });

  it("renders plan mode footer hint", () => {
    expect(stripAnsi(renderPlanModeFooterHint())).toBe(
      "⏸ plan mode on (shift+tab to cycle)",
    );
  });
});
