import { describe, expect, it } from "vitest";
import { displayWidth, stripAnsi } from "./ansi.js";
import { renderAnswerTextLines } from "./chat-blocks.js";
import { renderRichContentLines } from "./markdown-render.js";
import { renderTableLines, tableLineWidths } from "./markdown-table.js";

describe("table CJK border alignment", () => {
  it("pads after clipping a wide CJK glyph that does not fit the column", () => {
    // Column width 6: "LLM抽象" is 7 cols (LLM=3, 抽=2, 象=2). Clip drops 象 → width 5;
    // must pad to 6 so │ stays aligned.
    const lines = renderTableLines(
      {
        headers: ["模块", "路径"],
        rows: [
          ["LLM抽象", "a.go"],
          ["API入口", "b.go"],
          ["配置层", "c.go"],
        ],
      },
      28,
    );
    const widths = tableLineWidths(lines);
    expect(new Set(widths).size).toBe(1);
    const plain = lines.map((l) => stripAnsi(l));
    expect(plain.some((l) => l.includes("LLM抽"))).toBe(true);
  });

  it("aligns CJK file-list table at rich and answer layers", () => {
    const md = `## 2. 关键文件列表

| 模块 | 文件路径 | 功能说明 |
|------|---------|---------|
| LLM抽象 | \`service/ai_memory/llm/*.go\` | LLM接口定义与工厂 |
| LLM实现 | \`go_increase_common/llm/\`<br>\`volcengine.go\` | 火山引擎实现 |
| 服务层 | \`service/ai_memory/service.go\` | Agent业务编排 |
| API入口 | \`controller/openai_controller.go\` | OpenAI兼容入口 |
| 配置层 | \`config/llm.go\` | Provider配置 |
`;
    const rich = renderRichContentLines(md, 72);
    const tableLines = rich.filter((l) => /[┌┬┐├┼┤└┴┘│]/.test(stripAnsi(l)));
    expect(tableLines.length).toBeGreaterThan(3);
    const widths = tableLines.map((l) => displayWidth(stripAnsi(l)));
    expect(new Set(widths).size).toBe(1);

    const answer = renderAnswerTextLines(md, 80);
    const ansTable = answer.filter((l) => /[┌┬┐├┼┤└┴┘│]/.test(stripAnsi(l)));
    const aw = ansTable.map((l) => displayWidth(stripAnsi(l)));
    expect(new Set(aw).size).toBe(1);
  });
});
