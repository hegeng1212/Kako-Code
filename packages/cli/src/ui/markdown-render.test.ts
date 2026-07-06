import { describe, expect, it } from "vitest";
import { displayWidth, stripAnsi } from "./ansi.js";
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

  it("renders code blocks with left border", () => {
    const lines = renderRichContentLines("```\nconst x = 1;\n```", 60);
    const plain = lines.map((line) => stripAnsi(line)).join("\n");
    expect(plain).toContain("│");
    expect(plain).toContain("const x = 1;");
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
});
