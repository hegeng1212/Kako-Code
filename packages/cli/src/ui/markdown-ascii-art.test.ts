import { describe, expect, it } from "vitest";
import { displayWidth, stripAnsi } from "./ansi.js";
import { looksLikeAsciiArtLine, realignAsciiArtLines } from "./markdown-ascii-art.js";
import { parseMarkdownBlocks } from "./markdown-blocks.js";
import { renderAnswerTextLines } from "./chat-blocks.js";

describe("looksLikeAsciiArtLine", () => {
  it("detects pipe boxes and long underscore rules", () => {
    expect(looksLikeAsciiArtLine(" _______________________________")).toBe(true);
    expect(looksLikeAsciiArtLine("|        API 入口层             |")).toBe(true);
    expect(looksLikeAsciiArtLine("|_______________________________|")).toBe(true);
    expect(looksLikeAsciiArtLine("↓")).toBe(true);
    expect(looksLikeAsciiArtLine("---")).toBe(false);
    expect(looksLikeAsciiArtLine("普通段落文字")).toBe(false);
  });
});

describe("realignAsciiArtLines", () => {
  function rightBorderColumns(lines: readonly string[]): number[] {
    return lines.map((line) => {
      let col = 0;
      let last = -1;
      for (const ch of line) {
        if ("│┐┘|".includes(ch)) last = col + displayWidth(ch) - 1;
        col += displayWidth(ch);
      }
      return last;
    });
  }

  it("aligns right pipe borders despite CJK width", () => {
    const lines = [
      " ___________________",
      "| API 入口层 |",
      "| Open API / 阿里 API |",
      "| 米卡 Bot API (多 Agent) |",
      "|___________________|",
    ];
    const out = realignAsciiArtLines(lines);
    const pipeCols = out.map((line) => {
      let col = 0;
      let last = -1;
      for (const ch of line) {
        if (ch === "|") last = col;
        col += displayWidth(ch);
      }
      return last;
    });
    const contentCols = pipeCols.filter((c) => c >= 0);
    expect(new Set(contentCols).size).toBe(1);
    expect(displayWidth(out[0]!)).toBe(contentCols[0]! + 1);
  });

  it("aligns Unicode box-drawing right borders despite CJK width", () => {
    const lines = [
      "┌─────────────────────────────────────┐",
      "│        API 入口层             │",
      "│  ┌──────────┐ ┌─────────┐ ┌───────┐ │",
      "│  │ Open API │ │Baidu API│ │Ali API│ │",
      "│  └──────────┘ └─────────┘ └───────┘ │",
      "└─────────────────────────────────────┘",
      "↓",
    ];
    const out = realignAsciiArtLines(lines);
    const cols = rightBorderColumns(out).filter((c) => c >= 0);
    expect(cols.length).toBeGreaterThan(4);
    expect(new Set(cols).size).toBe(1);
    expect(out.some((line) => line.trim() === "↓")).toBe(true);
  });
});

describe("ascii art in markdown answers", () => {
  it("does not turn underscore box tops into HR or collapse spaces", () => {
    const ascii = [
      " _______________________________",
      "|        API 入口层             |",
      "|  Open API / 阿里 API          |",
      "|  百度 API / 百川 API          |",
      "|  米卡 Bot API (多 Agent)      |",
      "|_______________________________|",
    ].join("\n");

    const blocks = parseMarkdownBlocks(ascii);
    expect(blocks.some((b) => b.type === "hr")).toBe(false);
    expect(blocks.some((b) => b.type === "pre")).toBe(true);

    const plain = renderAnswerTextLines(ascii, 80).map(stripAnsi).filter((l) => l.trim());
    const pipeCols = plain.map((line) => {
      let col = 0;
      let last = -1;
      for (const ch of line) {
        if (ch === "|") last = col;
        col += displayWidth(ch);
      }
      return last;
    }).filter((c) => c >= 0);

    expect(pipeCols.length).toBeGreaterThan(2);
    expect(new Set(pipeCols).size).toBe(1);
    expect(plain.some((l) => l.includes("API 入口层"))).toBe(true);
    // Interior padding preserved (not collapsed to single spaces only).
    expect(plain.some((l) => /\| {2,}/.test(l))).toBe(true);
  });

  it("aligns box-drawing architecture diagrams in rendered answers", () => {
    const ascii = [
      "┌─────────────────────────────────────┐",
      "│        API 入口层             │",
      "│  ┌──────────┐ ┌─────────┐ ┌───────┐ │",
      "│  │ Open API │ │Baidu API│ │Ali API│ │",
      "│  └──────────┘ └─────────┘ └───────┘ │",
      "└─────────────────────────────────────┘",
    ].join("\n");

    const plain = renderAnswerTextLines(ascii, 120).map(stripAnsi).filter((l) => l.trim());
    const rightCols = plain.map((line) => {
      let col = 0;
      let last = -1;
      for (const ch of line) {
        if ("│┐┘".includes(ch)) last = col + displayWidth(ch) - 1;
        col += displayWidth(ch);
      }
      return last;
    }).filter((c) => c >= 0);

    expect(rightCols.length).toBeGreaterThan(4);
    expect(new Set(rightCols).size).toBe(1);
  });
});
