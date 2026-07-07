import { describe, expect, it } from "vitest";
import { stripAnsi } from "./ansi.js";
import {
  PLAN_PREVIEW_LABEL,
  renderPlanBoxLines,
  renderPlanPreviewTreeLine,
} from "./plan-box.js";

describe("plan-box", () => {
  it("renders preview tree line", () => {
    expect(stripAnsi(renderPlanPreviewTreeLine())).toBe(`└ ${PLAN_PREVIEW_LABEL}`);
  });

  it("renders plan markdown inside bordered box", () => {
    const plan = "# AI对话聊天机器人实现计划\n\n## 背景与目标\n\nBuild a chatbot.";
    const lines = renderPlanBoxLines({ planText: plan, width: 80 });
    const plain = lines.map((l) => stripAnsi(l));
    expect(plain[0]).toMatch(/^┌─+┐$/);
    expect(plain.some((l) => l.includes("│") && l.includes("AI对话聊天机器人"))).toBe(true);
    expect(plain[plain.length - 1]).toMatch(/^└─+┘$/);
  });

  it("shows scroll hint for long plans", () => {
    const plan = Array.from({ length: 12 }, (_, i) => `Line ${i + 1}`).join("\n");
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
