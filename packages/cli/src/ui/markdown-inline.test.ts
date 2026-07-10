import { describe, expect, it } from "vitest";
import { stripAnsi } from "./ansi.js";
import { parseInlineParts, renderInlineMarkdown } from "./markdown-inline.js";

describe("markdown-inline pills", () => {
  it("auto-highlights absolute paths", () => {
    const text = "文件位置：/Users/hegeng/workspace2/add.py";
    const rendered = renderInlineMarkdown(text);
    expect(stripAnsi(rendered)).toContain("/Users/hegeng/workspace2/add.py");
    expect(rendered).toContain("\x1b[48;5;236m");
  });

  it("auto-highlights shell commands", () => {
    const text = "运行 python3 add.py 得到结果";
    const rendered = renderInlineMarkdown(text);
    expect(stripAnsi(rendered)).toContain("python3 add.py");
    expect(rendered).toContain("\x1b[48;5;236m");
  });

  it("auto-highlights arithmetic expressions", () => {
    const parts = parseInlineParts("计算 23 + 47 等于 70");
    const codeParts = parts.filter((p) => p.style.code);
    expect(codeParts.some((p) => p.text === "23 + 47")).toBe(true);
  });

  it("preserves explicit backtick code", () => {
    const rendered = renderInlineMarkdown("使用 `python3 add.py` 运行");
    expect(stripAnsi(rendered)).toContain("python3 add.py");
    expect(rendered).toContain("\x1b[48;5;236m");
  });
});
