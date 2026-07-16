import { describe, expect, it } from "vitest";
import { ansi, stripAnsi } from "./ansi.js";
import { parseInlineParts, renderInlineMarkdown } from "./markdown-inline.js";

describe("markdown-inline pills", () => {
  it("auto-highlights absolute paths", () => {
    const text = "文件位置：/Users/hegeng/workspace2/add.py";
    const rendered = renderInlineMarkdown(text);
    expect(stripAnsi(rendered)).toContain("/Users/hegeng/workspace2/add.py");
    expect(rendered).toContain(ansi.blue);
    expect(rendered).not.toContain(ansi.codeBg);
  });

  it("auto-highlights shell commands as inline code (yellow)", () => {
    const text = "运行 python3 add.py 得到结果";
    const rendered = renderInlineMarkdown(text);
    expect(stripAnsi(rendered)).toContain("python3 add.py");
    expect(rendered).toContain(ansi.yellow);
    expect(rendered).not.toContain(ansi.codeBg);
  });

  it("auto-highlights arithmetic expressions", () => {
    const parts = parseInlineParts("计算 23 + 47 等于 70");
    const codeParts = parts.filter((p) => p.style.code);
    expect(codeParts.some((p) => p.text === "23 + 47")).toBe(true);
  });

  it("preserves explicit backtick code in yellow", () => {
    const rendered = renderInlineMarkdown("使用 `python3 add.py` 运行");
    expect(stripAnsi(rendered)).toContain("python3 add.py");
    expect(rendered).toContain(ansi.yellow);
    expect(rendered).not.toContain(ansi.codeBg);
  });

  it("keeps file paths light blue (distinct from inline code)", () => {
    const rendered = renderInlineMarkdown("见 `app/api/pkg/service/ai.go` 与 Completion()");
    expect(rendered).toContain(ansi.blue);
    expect(stripAnsi(rendered)).toContain("app/api/pkg/service/ai.go");
  });

  it("highlights directory paths light blue (including trailing slash)", () => {
    for (const path of [
      "cmd/main/main.go",
      "app/api/pkg/service/openai_service/",
      "pkg/aigc/templates/",
      "`app/api/pkg/service/openai_service/`",
    ]) {
      const rendered = renderInlineMarkdown(path);
      expect(rendered).toContain(ansi.blue);
      expect(rendered).not.toContain(ansi.yellow);
    }
  });

  it("colors quantities but not CJK list ordinals", () => {
    const qty = renderInlineMarkdown("支持 12+ 家 LLM，共 3 个入口");
    expect(qty).toContain(ansi.yellow);
    expect(stripAnsi(qty)).toContain("12+");
    expect(stripAnsi(qty)).toContain("3");

    const ordinal = parseInlineParts("1、统一入口：工厂模式");
    expect(ordinal.some((p) => p.style.quantity && p.text.startsWith("1"))).toBe(false);
  });
});
