import { describe, expect, it } from "vitest";
import { renderUserMessage } from "./chat-blocks.js";
import {
  extractImageLabelsInOrder,
  formatImageMarker,
  nextImageIndexFromText,
} from "./image-markers.js";
import { stripAnsi } from "./ansi.js";

describe("image-markers", () => {
  it("formats incrementing labels", () => {
    expect(formatImageMarker(1)).toBe("[Image #1]");
    expect(formatImageMarker(2)).toBe("[Image #2]");
  });

  it("extracts labels in appearance order", () => {
    expect(extractImageLabelsInOrder("[Image #1] 这是什么 [Image #2]")).toEqual([
      "[Image #1]",
      "[Image #2]",
    ]);
  });

  it("computes next index from existing markers", () => {
    expect(nextImageIndexFromText("[Image #1] hi")).toBe(2);
    expect(nextImageIndexFromText("[Image #1][Image #3]")).toBe(4);
  });
});

describe("renderUserMessage", () => {
  it("renders branch lines for pasted images aligned with parent text", () => {
    const lines = renderUserMessage("[Image #1] 这是什么图片", 100).map((line) => stripAnsi(line));
    expect(lines.some((line) => line.includes("> [Image #1] 这是什么图片"))).toBe(true);
    expect(lines.some((line) => line === "    └ [Image #1]")).toBe(true);
  });
});
