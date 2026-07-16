import { describe, expect, it } from "vitest";
import { ansi, displayWidth, stripAnsi } from "./ansi.js";
import { renderAnswerTextLines } from "./chat-blocks.js";
import { parseMarkdownBlocks } from "./markdown-blocks.js";
import { parseInlineParts, renderInlineMarkdown } from "./markdown-inline.js";
import { extractMarkdownTable, renderTableLines, tableLineWidths } from "./markdown-table.js";
import { renderRichContentLines } from "./markdown-render.js";

describe("markdown inline", () => {
  it("renders bold, italic, code, and links", () => {
    const rendered = renderInlineMarkdown("**bold** *italic* `code` [link](https://x.com)");
    expect(rendered).toContain("\x1b[1m");
    expect(rendered).toContain("\x1b[3m");
    expect(rendered).toContain("code");
    expect(rendered).toContain("link");
    expect(rendered).toContain("https://x.com");
  });

  it("parses nested-style markers into parts", () => {
    const parts = parseInlineParts("**名字** and plain");
    expect(parts).toHaveLength(2);
    expect(parts[0]?.style.bold).toBe(true);
    expect(parts[0]?.text).toBe("名字");
  });
});

describe("markdown blocks", () => {
  it("parses headings, lists, code, quotes, and tables", () => {
    const text = [
      "# Title",
      "",
      "- item one",
      "- item two",
      "",
      "> quoted line",
      "",
      "```js",
      "const x = 1",
      "```",
      "",
      "| A | B |",
      "|---|---|",
      "| 1 | 2 |",
    ].join("\n");

    const blocks = parseMarkdownBlocks(text);
    expect(blocks.map((b) => b.type)).toEqual([
      "heading",
      "ul",
      "blockquote",
      "code",
      "table",
    ]);
  });
});

describe("markdown table", () => {
  it("extracts a standard pipe table", () => {
    const lines = [
      "| 项目 | 大宝 | 小宝 |",
      "|------|------|------|",
      "| **名字** | 小航宝 | 小翊航 |",
    ];
    const extracted = extractMarkdownTable(lines, 0);
    expect(extracted?.table.headers).toEqual(["项目", "大宝", "小宝"]);
    expect(extracted?.table.rows).toHaveLength(1);
  });

  it("renders box-drawing borders", () => {
    const lines = renderTableLines(
      {
        headers: ["项目", "大宝", "小宝"],
        rows: [["名字", "小航宝", "小翊航"]],
      },
      80,
    );
    const plain = lines.map((line) => stripAnsi(line)).join("\n");
    expect(plain).toContain("┌");
    expect(plain).not.toContain("|------|");
  });

  it("keeps right border aligned with emoji and CJK status column", () => {
    const lines = renderTableLines(
      {
        headers: ["姓名", "角色", "项目", "进度", "截止日期", "状态"],
        rows: [
          ["张三", "前端", "Dashboard", "85%", "2026-03-15", "🟢 正常"],
          ["李四", "后端", "API Gateway", "60%", "2026-04-01", "🟡 有风险"],
          ["王五", "测试", "E2E Suite", "100%", "2026-02-28", "✅ 已完成"],
          ["赵六", "设计", "UI Kit", "40%", "2026-05-10", "🔴 延期"],
        ],
      },
      120,
    );

    const widths = tableLineWidths(lines);
    const expected = widths[0]!;
    for (const width of widths) {
      expect(width).toBe(expected);
    }

    expect(displayWidth("🟢")).toBe(2);
    expect(displayWidth("✅")).toBe(2);
  });

  it("does not add extra vertical padding between table rows", () => {
    const lines = renderTableLines(
      {
        headers: ["A", "B"],
        rows: [["1", "2"], ["3", "4"]],
      },
      40,
    );

    const indexOne = lines.findIndex((line) => stripAnsi(line).includes("1"));
    const indexThree = lines.findIndex((line) => stripAnsi(line).includes("3"));
    expect(indexOne).toBeGreaterThanOrEqual(0);
    expect(indexThree).toBe(indexOne + 1);
  });
});

describe("markdown render", () => {
  it("renders headings and bullet lists with styling", () => {
    const lines = renderRichContentLines("## Section\n\n- **bold item**\n- plain", 60);
    const plain = lines.map((line) => stripAnsi(line)).join("\n");
    expect(plain).toContain("Section");
    expect(plain).toContain("•");
    expect(plain).toContain("bold item");
  });

  it("renders headings in white, not accent red", () => {
    for (const src of ["# Title One", "## 四、关键文件速查表", "### Nested"]) {
      const lines = renderRichContentLines(src, 60);
      const joined = lines.join("\n");
      expect(joined).toContain(ansi.text);
      expect(joined).toContain(ansi.bold);
      expect(joined).not.toContain(ansi.accentBold);
      expect(joined).not.toContain(ansi.accent);
    }
  });

  it("keeps ordered list markers white", () => {
    const lines = renderRichContentLines("1. first\n2. second", 60);
    const joined = lines.join("\n");
    expect(joined).toContain(`${ansi.text}1.${ansi.reset}`);
    expect(joined).toContain(`${ansi.text}2.${ansi.reset}`);
  });

  it("keeps ordered list markers white across flow connectors", () => {
    const md = [
      "1. HTTP 请求",
      "↓",
      "2. Router (router.go:37)",
      "↓",
      "3. Controller",
    ].join("\n");
    const blocks = parseMarkdownBlocks(md);
    expect(blocks).toEqual([
      {
        type: "ol",
        items: ["HTTP 请求", "Router (router.go:37)", "Controller"],
        connectors: ["↓", "↓"],
      },
    ]);
    const joined = renderRichContentLines(md, 80).join("");
    expect(joined).toContain(`${ansi.text}1.${ansi.reset}`);
    expect(joined).toContain(`${ansi.text}2.${ansi.reset}`);
    expect(joined).toContain(`${ansi.text}3.${ansi.reset}`);
    expect(joined).not.toContain("\x1b[38;5;151m");
    expect(joined).not.toContain("\x1b[38;5;79m");
  });

  it("renders code blocks without left gutter bar or background strip", () => {
    const lines = renderRichContentLines("```\nconst x = 1;\n```", 60);
    const joined = lines.join("\n");
    const plain = lines.map((line) => stripAnsi(line)).join("\n");
    expect(plain).not.toContain("│");
    expect(plain).toContain("const x = 1;");
    expect(joined).not.toContain(ansi.codeBg);
  });

  it("syntax-highlights fenced code without a background strip", () => {
    const lines = renderRichContentLines(
      ['```json', '// comment', '{', '  "model": "deepseek-v3",', '  "stream": true,', '  "temp": 0.6', '}', '```'].join("\n"),
      60,
    );
    const joined = lines.join("\n");
    expect(joined).not.toContain(ansi.codeBg);
    expect(joined).not.toMatch(/(?:^|\n)│/);
    // VS Code Dark+ roles (256-color approximations)
    expect(joined).toContain("\x1b[38;5;65m"); // comment
    expect(joined).toContain("\x1b[38;5;117m"); // json key (variable)
    expect(joined).toContain("\x1b[38;5;173m"); // string value
    expect(joined).toContain("\x1b[38;5;75m"); // boolean keyword
  });

  it("highlights Go function names in fenced code", () => {
    const lines = renderRichContentLines(
      ["```go", "func Completion(ctx context.Context) error {", "  return nil", "}", "```"].join("\n"),
      80,
    );
    const joined = lines.join("\n");
    expect(joined).toContain("\x1b[38;5;75m"); // keyword (func / return / nil)
    expect(joined).toContain("\x1b[38;5;187m"); // function (Completion)
    expect(stripAnsi(joined)).toContain("Completion");
  });

  it("renders mixed answer content including table", () => {
    const answer = [
      "您有两个宝宝，信息如下：",
      "",
      "| 项目 | 大宝 | 小宝 |",
      "|------|------|------|",
      "| 名字 | 小航宝 | 小翊航 |",
      "",
      "- **大宝** 8 岁",
      "- **小宝** 4 个月",
    ].join("\n");

    const lines = renderAnswerTextLines(answer, 100);

    const plain = lines.map((line) => stripAnsi(line)).join("\n");
    expect(plain).toContain("您有两个宝宝");
    expect(plain).toContain("┌");
    expect(plain).toContain("•");
    expect(plain).not.toContain("|------|");
  });

  it("keeps answer table borders continuous without blank gaps", () => {
    const answer = [
      "| 模块 | 路径 |",
      "|------|------|",
      "| LLM | `/service/ai_memory/llm/factory.go` |",
      "| Config | `/config.yaml` |",
    ].join("\n");

    const lines = renderAnswerTextLines(answer, 100);
    const plainLines = lines.map((line) => stripAnsi(line));
    const tableStart = plainLines.findIndex((line) => line.includes("┌"));
    const tableEnd = plainLines.findIndex((line) => line.includes("└"));
    expect(tableStart).toBeGreaterThanOrEqual(0);
    expect(tableEnd).toBeGreaterThan(tableStart);

    const tableBody = plainLines.slice(tableStart, tableEnd + 1);
    expect(tableBody.every((line) => line.trim() !== "")).toBe(true);
    for (let i = 0; i < tableBody.length - 1; i++) {
      expect(tableBody[i + 1]).not.toBe("");
    }

    const pathLine = lines.find((line) => line.includes("factory.go"));
    expect(pathLine).toBeDefined();
    expect(pathLine!).toContain(ansi.blue);
    expect(pathLine!).not.toContain(ansi.codeBg);
  });
});
