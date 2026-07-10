import { describe, expect, it } from "vitest";
import { stripAnsi } from "./ansi.js";
import { renderUserMessage } from "./chat-blocks.js";
import { extractDisplayFilePaths, formatFileBranchLabel } from "./file-path-display.js";

describe("file path display", () => {
  it("extracts excel paths with spaces from user text", () => {
    const path = "/Users/hegeng/Documents/副本【bebebus周报】 公式版.xlsx";
    const paths = extractDisplayFilePaths(`${path}  这是什么内容`);
    expect(paths).toEqual([path]);
  });

  it("formats branch label as basename", () => {
    expect(formatFileBranchLabel("/tmp/report.xlsx")).toBe("report.xlsx");
  });
});

describe("renderUserMessage with file paths", () => {
  it("renders file branch lines distinct from image markers", () => {
    const path = "/Users/hegeng/Documents/report.xlsx";
    const lines = renderUserMessage(`${path}  这是什么内容`, 100).map((line) => stripAnsi(line));
    expect(lines.some((line) => line.includes(`> ${path}  这是什么内容`))).toBe(true);
    expect(lines.some((line) => line.includes("└ 📄 report.xlsx"))).toBe(true);
  });
});
