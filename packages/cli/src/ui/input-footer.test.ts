import { describe, expect, it } from "vitest";
import { ansi, stripAnsi } from "./ansi.js";
import {
  HISTORY_LABEL_COLUMN,
  nextPermissionMode,
  renderHistorySeparator,
  renderInputCopyHint,
  renderInputTopSeparator,
  renderPermissionModeFooterHint,
  renderPlanModeFooterHint,
} from "./input-footer.js";

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

  it("formats History n/n like Claude Code for any browse position", () => {
    for (const [pos, total] of [
      [1, 1],
      [11, 12],
      [21, 21],
    ] as const) {
      const label = `History ${pos}/${total}`;
      const line = stripAnsi(renderHistorySeparator(label, 48));
      expect(line).toContain(label);
      expect(line.indexOf(label)).toBe(HISTORY_LABEL_COLUMN - 1);
    }
  });

  it("renders clear hint on its own row above the separator", () => {
    const hint = "Esc again to clear";
    const cols = 72;
    const line = stripAnsi(renderInputCopyHint(cols, hint));
    expect(line.endsWith(hint)).toBe(true);
    expect(line.length).toBe(cols);
    expect(line.startsWith(" ")).toBe(true);
  });

  it("cycles default → plan → bypassPermissions → default", () => {
    expect(nextPermissionMode("default")).toBe("plan");
    expect(nextPermissionMode("plan")).toBe("bypassPermissions");
    expect(nextPermissionMode("bypassPermissions")).toBe("default");
    expect(nextPermissionMode("acceptEdits")).toBe("plan");
  });

  it("renders plan mode footer hint", () => {
    expect(stripAnsi(renderPlanModeFooterHint())).toBe(
      "  ⏸ plan mode on (shift+tab to cycle) · ← for agents",
    );
  });

  it("renders manual mode with muted pause icon (Claude-style)", () => {
    expect(stripAnsi(renderPermissionModeFooterHint("default"))).toBe(
      "  ⏸ manual mode on · ? for shortcuts · ← for agents",
    );
  });

  it("renders plan idle/busy icons", () => {
    expect(stripAnsi(renderPermissionModeFooterHint("plan", { busy: false }))).toBe(
      "  ⏸ plan mode on (shift+tab to cycle) · ← for agents",
    );
    expect(stripAnsi(renderPermissionModeFooterHint("plan", { busy: true }))).toBe(
      "  ▶▶ plan mode on (shift+tab to cycle) · ← for agents",
    );
  });

  it("renders auto mode with yellow dual-play icon (Claude-style)", () => {
    expect(stripAnsi(renderPermissionModeFooterHint("bypassPermissions", { busy: false }))).toBe(
      "  ▶▶ auto mode on (shift+tab to cycle) · ← for agents",
    );
    expect(stripAnsi(renderPermissionModeFooterHint("bypassPermissions", { busy: true }))).toBe(
      "  ▶▶ auto mode on (shift+tab to cycle) · ← for agents",
    );
    const raw = renderPermissionModeFooterHint("bypassPermissions");
    expect(raw).toContain(ansi.yellow);
    expect(raw).toContain(ansi.muted);
  });

  it("appends ↓ to manage when subagents are live", () => {
    expect(
      stripAnsi(
        renderPermissionModeFooterHint("plan", {
          busy: false,
          canManageAgents: true,
          agentCount: 1,
        }),
      ),
    ).toBe(
      "  ⏸ plan mode on (shift+tab to cycle) · ← 1 agent · ↓ to manage",
    );
  });

  it("does not render acceptEdits in the shift+tab footer (falls back to manual label)", () => {
    expect(stripAnsi(renderPermissionModeFooterHint("acceptEdits"))).toBe(
      "  ⏸ manual mode on · ? for shortcuts · ← for agents",
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
