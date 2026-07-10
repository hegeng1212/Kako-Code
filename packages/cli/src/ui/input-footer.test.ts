import { describe, expect, it } from "vitest";
import { stripAnsi } from "./ansi.js";
import { HISTORY_LABEL_COLUMN, renderHistorySeparator, renderInputCopyHint, renderInputTopSeparator, renderPlanModeFooterHint } from "./input-footer.js";

describe("input-footer", () => {
  it("renders history label at fixed left offset with white rule", () => {
    const line = stripAnsi(renderHistorySeparator("History 11/12", 40));
    expect(line).toContain("History 11/12");
    expect(line.indexOf("History 11/12")).toBe(HISTORY_LABEL_COLUMN - 1);
    expect(line.slice(0, HISTORY_LABEL_COLUMN - 1)).toMatch(/^─+$/);
    expect(line).toMatch(/^─+History 11\/12─+$/);
  });

  it("keeps history separator free of the clear hint", () => {
    const hint = "Esc again to clear";
    const cols = 60;
    const line = stripAnsi(renderHistorySeparator("History 36/36", cols));
    expect(line).toContain("History 36/36");
    expect(line).not.toContain(hint);
    expect(line.length).toBe(cols);
  });

  it("renders clear hint on its own row above the separator", () => {
    const hint = "Esc again to clear";
    const cols = 72;
    const line = stripAnsi(renderInputCopyHint(cols, hint));
    expect(line.endsWith(hint)).toBe(true);
    expect(line.length).toBe(cols);
    expect(line.startsWith(" ")).toBe(true);
  });

  it("renders plan mode footer hint", () => {
    expect(stripAnsi(renderPlanModeFooterHint())).toBe(
      "⏸ plan mode on (shift+tab to cycle)",
    );
  });

  it("renders right-aligned copy hint on the input top separator", () => {
    const hint = "copied 21 chars to clipboard";
    const cols = 72;
    const line = stripAnsi(renderInputTopSeparator(cols, hint));
    expect(line.endsWith(hint)).toBe(true);
    expect(line.length).toBe(cols);
  });

  it("renders copy hint on its own row above the separator", () => {
    const hint = "copied 21 chars to clipboard";
    const cols = 72;
    const line = stripAnsi(renderInputCopyHint(cols, hint));
    expect(line.endsWith(hint)).toBe(true);
    expect(line.length).toBe(cols);
    expect(line.startsWith(" ")).toBe(true);
  });
});
