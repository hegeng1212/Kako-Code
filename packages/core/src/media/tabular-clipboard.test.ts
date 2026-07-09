import { describe, expect, it } from "vitest";
import { isTabularClipboardText } from "./tabular-clipboard.js";

describe("isTabularClipboardText", () => {
  it("detects multi-row TSV from spreadsheet copies", () => {
    const tsv = "Name\tAge\nAlice\t30\nBob\t25";
    expect(isTabularClipboardText(tsv)).toBe(true);
  });

  it("detects single-row multi-column TSV", () => {
    expect(isTabularClipboardText("A\tB\tC")).toBe(true);
  });

  it("rejects plain multiline text without tabs", () => {
    expect(isTabularClipboardText("line one\nline two")).toBe(false);
  });

  it("rejects single scalar cell text", () => {
    expect(isTabularClipboardText("hello")).toBe(false);
  });
});
