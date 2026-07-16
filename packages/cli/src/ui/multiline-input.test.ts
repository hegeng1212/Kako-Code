import { describe, expect, it } from "vitest";
import { stripAnsi } from "./ansi.js";
import {
  INPUT_MAX_VISIBLE_LINES,
  clampInputScrollRow,
  cursorLogicalLine,
  inputBlockRowCount,
  inputOffsetFromScreen,
  insertNewlineAtCursor,
  moveCursorDown,
  moveCursorUp,
  renderMultilineInput,
  selectedText,
  shouldBrowseHistoryOnDown,
  shouldBrowseHistoryOnUp,
} from "./multiline-input.js";

describe("multiline-input", () => {
  it("inserts explicit newlines", () => {
    const next = insertNewlineAtCursor("hello", 5);
    expect(next.text).toBe("hello\n");
    expect(next.cursor).toBe(6);
  });

  it("moves cursor across logical lines", () => {
    const text = "line1\nline2";
    const onSecond = text.length;
    expect(moveCursorUp(text, onSecond)).toBe(5);
    expect(moveCursorDown(text, 5)).toBe(onSecond);
  });

  it("triggers history only from the first line on up", () => {
    expect(shouldBrowseHistoryOnUp("one\ntwo", 0)).toBe(true);
    expect(shouldBrowseHistoryOnUp("one\ntwo", 4)).toBe(false);
  });

  it("triggers history only from end of buffer on down", () => {
    const text = "one\ntwo";
    expect(shouldBrowseHistoryOnDown(text, text.length)).toBe(true);
    expect(shouldBrowseHistoryOnDown(text, 3)).toBe(false);
  });

  it("renders continuation lines indented under the prompt", () => {
    const rendered = renderMultilineInput({
      value: "first\nsecond",
      cursor: 8,
      scrollRow: 0,
      cols: 80,
    });
    expect(rendered.rows).toHaveLength(2);
    expect(stripAnsi(rendered.rows[0]!)).toContain("> first");
    expect(stripAnsi(rendered.rows[1]!)).toContain("  second");
  });

  it("maps screen column to buffer offset", () => {
    const value = "line1\nline2";
    expect(
      inputOffsetFromScreen({ value, scrollRow: 0, screenRow: 1, screenCol: 1 + 2 + 3 }),
    ).toBe(9);
  });

  it("extracts selected substring", () => {
    expect(selectedText("hello world", 0, 5)).toBe("hello");
  });

  it("clips long lines so the prompt stays visible", () => {
    const long = "x".repeat(120);
    const rendered = renderMultilineInput({
      value: long,
      cursor: long.length,
      scrollRow: 0,
      cols: 40,
    });
    expect(stripAnsi(rendered.rows[0]!)).toMatch(/^> /);
    expect(stripAnsi(rendered.rows[0]!).length).toBeLessThanOrEqual(40);
  });

  it("scrolls the viewport when cursor moves past max visible lines", () => {
    const lines = Array.from({ length: INPUT_MAX_VISIBLE_LINES + 2 }, (_, i) => `line${i + 1}`).join(
      "\n",
    );
    const cursorLine = cursorLogicalLine(lines, lines.length);
    const scrollRow = clampInputScrollRow(0, cursorLine, INPUT_MAX_VISIBLE_LINES + 2);
    expect(scrollRow).toBe(2);
    const rendered = renderMultilineInput({
      value: lines,
      cursor: lines.length,
      scrollRow,
      cols: 80,
    });
    expect(rendered.rows).toHaveLength(INPUT_MAX_VISIBLE_LINES);
    expect(stripAnsi(rendered.rows[0]!)).toContain("line3");
  });

  it("inputBlockRowCount matches renderMultilineInput with the same cursor", () => {
    const lines = Array.from({ length: 8 }, (_, i) => `line${i + 1}`).join("\n");
    const cursor = lines.length;
    const count = inputBlockRowCount(lines, 0, 80, 5, cursor);
    const rendered = renderMultilineInput({
      value: lines,
      cursor,
      scrollRow: 0,
      cols: 80,
      maxVisibleLines: 5,
    });
    expect(count).toBe(rendered.rows.length);
    expect(count).toBe(5);
  });
});
