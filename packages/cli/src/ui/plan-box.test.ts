import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { stripAnsi } from "./ansi.js";
import {
  PLAN_PREVIEW_LABEL,
  renderCurrentPlanTreeLine,
  renderPlanBoxLines,
  renderPlanEnabledLine,
  renderPlanPathLine,
  renderPlanPreviewTreeLine,
} from "./plan-box.js";

describe("plan-box", () => {
  it("renders plan enabled tree line", () => {
    expect(stripAnsi(renderPlanEnabledLine())).toBe("└ Enabled plan mode");
  });

  it("renders preview tree line", () => {
    expect(stripAnsi(renderPlanPreviewTreeLine())).toBe(`└ ${PLAN_PREVIEW_LABEL}`);
  });

  it("renders current plan tree and path lines", () => {
    expect(stripAnsi(renderCurrentPlanTreeLine())).toBe("└ Current Plan");
    const planPath = join(homedir(), ".kako", "plans", "api-purrfect-wren.md");
    expect(stripAnsi(renderPlanPathLine(planPath))).toBe("~/.kako/plans/api-purrfect-wren.md");
  });

  it("renders plan markdown inside bordered box with right edge", () => {
    const plan = "# AI对话聊天机器人实现计划\n\n## 背景与目标\n\nBuild a chatbot.";
    const lines = renderPlanBoxLines({ planText: plan, width: 80 });
    const plain = lines.map((l) => stripAnsi(l));
    expect(plain[0]).toMatch(/^┌─+┐$/);
    const body = plain.find((l) => l.includes("AI对话"));
    expect(body).toBeDefined();
    expect(body).toMatch(/│.*│$/);
    expect(plain[plain.length - 1]).toMatch(/^└─+┘$/);
  });

  it("shows scroll hint for long plans", () => {
    const plan = Array.from({ length: 15 }, (_, i) => `## Section ${i + 1}\n\nDetail for step ${i + 1}.`).join(
      "\n\n",
    );
    const lines = renderPlanBoxLines({ planText: plan, width: 80 });
    const plain = lines.map((l) => stripAnsi(l)).join("\n");
    expect(plain).toContain("Jump to bottom");
  });

  it("renders empty plan placeholder", () => {
    const lines = renderPlanBoxLines({ planText: "  ", width: 60 });
    const plain = lines.map((l) => stripAnsi(l)).join("\n");
    expect(plain).toContain("(empty plan)");
  });
});
